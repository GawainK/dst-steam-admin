#!/usr/bin/env python3
"""Own the room's shard processes, console pipes, output and health state."""
import configparser
import filecmp
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time


STATE_FILE = Path(os.environ.get("DST_STATE_FILE", "/run/dst/status.json"))
BINARY = "bin64/dontstarve_dedicated_server_nullrenderer_x64"
MANIFEST = "steamapps/appmanifest_343050.acf"
MAX_LINE = 64 * 1024


def sync_steam_library(install, steamcmd):
    source = steamcmd / "linux64/steamclient.so"
    target = install / "bin64/lib64/steamclient.so"
    if not source.is_file():
        print("[Setup] SteamCMD 64-bit library unavailable; retaining current game library", flush=True)
        return
    with source.open("rb") as library:
        header = library.read(20)
    if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
        raise ValueError("SteamCMD library must be an ELF x86-64 shared library")
    if target.is_file() and filecmp.cmp(source, target, shallow=False):
        return

    target.parent.mkdir(parents=True, exist_ok=True)

    def atomic_copy(original, destination):
        fd, name = tempfile.mkstemp(prefix=".steamclient-", dir=target.parent)
        os.close(fd)
        temporary = Path(name)
        try:
            shutil.copy2(original, temporary)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)

    if target.is_file():
        atomic_copy(target, target.with_name("steamclient.so.before-steamcmd"))
    atomic_copy(source, target)
    print("[Setup] Synced SteamCMD 64-bit library for Workshop downloads", flush=True)


def build_id(root):
    try:
        match = re.search(r'"buildid"\s*"(\d+)"', (root / MANIFEST).read_text())
        return match.group(1) if match else ""
    except OSError:
        return ""


def healthcheck():
    try:
        state = json.loads(STATE_FILE.read_text())
        if state["overall"] != "running" or not state["shards"]:
            return 1
        if not 0 <= time.time() - state["updatedAt"] < 10:
            return 1
        for pid in [state["pid"], *[shard["pid"] for shard in state["shards"]]]:
            if not isinstance(pid, int) or pid <= 0:
                return 1
            os.kill(pid, 0)
        return 0 if all(shard["ready"] and shard["exitCode"] is None for shard in state["shards"]) else 1
    except (OSError, ValueError, KeyError, TypeError):
        return 1


class Supervisor:
    def __init__(self):
        self.install = Path(os.environ.get("DST_INSTALL_ROOT", "/opt/dst"))
        self.cluster = Path(os.environ.get("DST_CLUSTER_ROOT", "/var/lib/dst/cluster"))
        self.scripts = Path(os.environ.get("DST_SCRIPT_ROOT", "/usr/local/bin"))
        self.conf = os.environ.get("DST_CONF_DIR", "DoNotStarveTogether")
        self.room = os.environ.get("DST_CLUSTER_DIR_NAME", "Cluster")
        self.shards = []
        self.setup = None
        self.selector = selectors.DefaultSelector()
        self.stopping = False
        self.forced = False
        self.overall = "starting"
        self.version = ""
        self.shutdown_timeout = float(os.environ.get("DST_SHUTDOWN_TIMEOUT", "40"))
        self.terminate_timeout = float(os.environ.get("DST_TERMINATE_TIMEOUT", "5"))
        if not 0 <= self.shutdown_timeout <= 45 or not 0 <= self.terminate_timeout <= 10:
            raise ValueError("Shutdown timeouts must fit within the container's 60s grace period")

    def publish(self):
        if self.overall in ("starting", "running") and self.shards:
            self.overall = "running" if all(s["ready"] and s["process"].poll() is None for s in self.shards) else "starting"
        state = {
            "pid": os.getpid(), "updatedAt": time.time(), "overall": self.overall,
            "version": self.version, "buildId": build_id(self.install), "forced": self.forced,
            "shards": [{"name": s["name"], "pid": s["process"].pid,
                        "ready": s["ready"], "exitCode": s["process"].poll()} for s in self.shards]
        }
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATE_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(state))
        temporary.replace(STATE_FILE)

    def request_stop(self, _signal, _frame):
        self.stopping = True

    @staticmethod
    def signal_group(process, sig):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass

    def run_setup(self, command, env=None):
        if self.stopping:
            raise InterruptedError()
        self.setup = subprocess.Popen(command, env=env, start_new_session=True)
        while self.setup.poll() is None:
            if self.stopping:
                self.signal_group(self.setup, signal.SIGTERM)
                try:
                    self.setup.wait(timeout=self.terminate_timeout)
                except subprocess.TimeoutExpired:
                    self.signal_group(self.setup, signal.SIGKILL)
                    self.setup.wait()
                raise InterruptedError()
            self.publish()
            time.sleep(0.1)
        code = self.setup.returncode
        self.setup = None
        if code:
            raise subprocess.CalledProcessError(code, command)

    def prepare(self):
        # Both shards use the server's persistent installation, independent of
        # the runtime image version. Existing offline starts remain supported.
        if os.environ.get("DST_SKIP_UPDATE") != "1" or not (self.install / BINARY).is_file():
            self.run_setup([str(self.scripts / "dst-install-server")])
        if not os.access(self.install / BINARY, os.X_OK):
            raise ValueError("DST installation did not produce an executable server")
        if os.environ.get("DST_SKIP_STEAM_LIBRARY_SYNC") != "1":
            sync_steam_library(self.install, Path(os.environ.get("DST_STEAMCMD_ROOT", "/opt/steamcmd")))
        try:
            self.version = (self.install / "version.txt").read_text().strip()
        except OSError:
            pass
        env = {**os.environ, "DST_SHARD": "Master", "DST_SERVER_PORT": os.environ.get("DST_MASTER_PORT", "")}
        self.run_setup([str(self.scripts / "dst-render-config")], env)
        config = configparser.ConfigParser(interpolation=None, strict=False)
        config.read(self.cluster / self.conf / self.room / "cluster.ini")
        enabled = config.getboolean("SHARD", "shard_enabled", fallback=True)
        if enabled:
            env.update(DST_SHARD="Caves", DST_SERVER_PORT=os.environ.get("DST_CAVES_PORT", ""))
            self.run_setup([str(self.scripts / "dst-render-config")], env)
        return ["Master", "Caves"] if enabled else ["Master"]

    def start_shard(self, name):
        process = subprocess.Popen([
            str(self.install / BINARY), "-console", "-persistent_storage_root", str(self.cluster),
            "-conf_dir", self.conf, "-cluster", self.room, "-shard", name
        ], cwd=self.install / "bin64", stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, start_new_session=True)
        os.set_blocking(process.stdout.fileno(), False)
        os.set_blocking(process.stdin.fileno(), False)
        default_markers = "registered via geo DNS,Sim paused"
        if name == "Caves":
            default_markers += ",[Shard] secondary shard LUA is now ready!"
        markers = os.environ.get("DST_READY_MARKERS", default_markers)
        if name == "Caves":
            markers = os.environ.get("DST_CAVES_READY_MARKERS", markers)
        shard = {"name": name, "process": process, "ready": False, "buffer": b"",
                 "markers": [m.strip() for m in re.split(r"[,\n]", markers) if m.strip()]}
        self.shards.append(shard)
        self.selector.register(process.stdout, selectors.EVENT_READ, shard)

    def pump(self, timeout=0.1):
        for key, _ in self.selector.select(timeout):
            shard = key.data
            chunk = os.read(key.fileobj.fileno(), 8192)
            if not chunk:
                self.selector.unregister(key.fileobj)
                key.fileobj.close()
                continue
            shard["buffer"] += chunk
            while b"\n" in shard["buffer"]:
                line, shard["buffer"] = shard["buffer"].split(b"\n", 1)
                message = line[:MAX_LINE].decode("utf8", errors="replace")
                if not shard["ready"] and any(marker in message for marker in shard["markers"]):
                    shard["ready"] = True
                    # Publish readiness before its log line becomes visible.
                    self.publish()
                print(f'[{shard["name"]}] {message}', flush=True)
            if len(shard["buffer"]) > MAX_LINE:
                print(f'[{shard["name"]}] Oversized log line discarded', flush=True)
                shard["buffer"] = b""

    def wait_for_exit(self, seconds):
        deadline = time.monotonic() + seconds
        while any(s["process"].poll() is None for s in self.shards) and time.monotonic() < deadline:
            self.pump()
            self.publish()

    def shutdown(self):
        self.overall = "stopping"
        self.publish()
        for shard in self.shards:
            process = shard["process"]
            if process.poll() is None:
                try:
                    os.write(process.stdin.fileno(), b"c_shutdown(true)\n")
                except (BrokenPipeError, BlockingIOError):
                    pass
        self.wait_for_exit(self.shutdown_timeout)
        remaining = [s["process"] for s in self.shards if s["process"].poll() is None]
        if remaining:
            self.forced = True
            print("[Supervisor] Save/exit deadline exceeded; sending SIGTERM", flush=True)
            for process in remaining:
                self.signal_group(process, signal.SIGTERM)
            self.wait_for_exit(self.terminate_timeout)
        for shard in self.shards:
            process = shard["process"]
            # Reclaim descendants that might otherwise keep output pipes open.
            self.signal_group(process, signal.SIGKILL)
            process.wait()
            process.stdin.close()
        drain_deadline = time.monotonic() + 1
        while self.selector.get_map() and time.monotonic() < drain_deadline:
            self.pump(0.05)
        self.selector.close()

    def run(self):
        signal.signal(signal.SIGTERM, self.request_stop)
        signal.signal(signal.SIGINT, self.request_stop)
        code = 0
        self.publish()
        print("Starting DST shard Master", flush=True)
        try:
            names = self.prepare()
            if self.stopping:
                raise InterruptedError()
            for name in names:
                self.start_shard(name)
            while not self.stopping:
                self.pump()
                for shard in self.shards:
                    result = shard["process"].poll()
                    if result is not None:
                        code = max(1, result) if result >= 0 else 128 - result
                        print(f'[Supervisor] {shard["name"]} exited ({result}); closing room', flush=True)
                        return code
                self.overall = "running" if all(s["ready"] for s in self.shards) else "starting"
                self.publish()
        except InterruptedError:
            pass
        except subprocess.CalledProcessError as error:
            code = error.returncode if error.returncode > 0 else 128 - error.returncode
        except Exception as error:
            print(f"[Supervisor] {error}", file=sys.stderr, flush=True)
            code = 1
        finally:
            self.shutdown()
            self.overall = "failed" if code else "stopped"
            self.publish()
        return code


if __name__ == "__main__":
    if sys.argv[1:] == ["--healthcheck"]:
        sys.exit(healthcheck())
    sys.exit(Supervisor().run())
