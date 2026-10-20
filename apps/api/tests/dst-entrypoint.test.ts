import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "../..");
const fixtures: { root: string; child: ChildProcess; done: Promise<number | null> }[] = [];

function startServer(enableCaves = true, options: Record<string, string> = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "dst-entrypoint-"));
  const cluster = resolve(root, "cluster");
  const install = resolve(root, "install");
  const scripts = resolve(root, "scripts");
  mkdirSync(resolve(cluster, "admin"), { recursive: true });
  mkdirSync(resolve(install, "bin64"), { recursive: true });
  mkdirSync(scripts);
  writeFileSync(resolve(cluster, "admin/server-config.json"), JSON.stringify({
    steamToken: "test-token", clusterName: "Test", enableCaves,
    masterPort: 10999, cavesPort: 11000
  }, null, 2));
  for (const [src, dest] of [["render-config.sh", "dst-render-config"], ["supervisor.py", "dst-supervisor.py"]]) {
    const source = resolve(repoRoot, "docker/dst", src);
    if (existsSync(source)) {
      copyFileSync(source, resolve(scripts, dest));
      chmodSync(resolve(scripts, dest), 0o755);
    }
  }
  writeFileSync(resolve(scripts, "dst-install-server"), '#!/bin/sh\necho install >> "$TEST_ROOT/installs"\nif [ "${HOLD_INSTALL:-}" = "1" ]; then echo "[Setup] installing"; while :; do sleep 0.1; done; fi\nexit "${INSTALL_EXIT:-0}"\n', { mode: 0o755 });
  writeFileSync(resolve(install, "bin64/dontstarve_dedicated_server_nullrenderer_x64"), `#!/usr/bin/env python3
import json, os, select, signal, sys, time
from pathlib import Path
args = sys.argv[1:]
shard = args[args.index('-shard') + 1]
root = Path(os.environ['TEST_ROOT'])
(root / (shard + '.pid')).write_text(str(os.getpid()))
(root / (shard + '.args')).write_text(json.dumps(args))
(root / (shard + '.cwd')).write_text(os.getcwd())
def stop(sig, frame):
    if os.environ.get('IGNORE_STOP') == '1': return
    (root / (shard + '.stopped')).write_text('signal')
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
print('game ready', flush=True)
if shard != os.environ.get('HOLD_READY'):
    print('Sim paused', flush=True)
started = time.monotonic()
while True:
    if shard == os.environ.get('EXIT_SHARD') and time.monotonic() - started > 0.3:
        sys.exit(7)
    if select.select([sys.stdin], [], [], 0.05)[0]:
        command = sys.stdin.readline()
        if command.strip() == 'c_shutdown(true)' and os.environ.get('IGNORE_STOP') != '1':
            (root / (shard + '.stopped')).write_text('graceful')
            sys.exit(0)
`, { mode: 0o755 });
  if (options.DST_UPDATE_MODE === "image") {
    const seed = resolve(root, "image");
    mkdirSync(resolve(seed, "bin64"), { recursive: true });
    mkdirSync(resolve(seed, "steamapps"));
    copyFileSync(resolve(install, "bin64/dontstarve_dedicated_server_nullrenderer_x64"), resolve(seed, "bin64/dontstarve_dedicated_server_nullrenderer_x64"));
    writeFileSync(resolve(seed, "steamapps/appmanifest_343050.acf"), '"buildid" "123"\n');
    writeFileSync(resolve(seed, "version.txt"), "999999");
    rmSync(install, { recursive: true });
    options = { ...options, DST_IMAGE_ROOT: seed };
  }
  const env = {
    ...process.env, TEST_ROOT: root,
    DST_CLUSTER_ROOT: cluster, DST_MODS_ROOT: resolve(root, "mods"),
    DST_INSTALL_ROOT: install, DST_SCRIPT_ROOT: scripts,
    DST_TEMPLATE_ROOT: resolve(repoRoot, "docker/dst"),
    DST_STATE_FILE: resolve(root, "runtime/status.json"),
    DST_SHUTDOWN_TIMEOUT: "0.4", DST_TERMINATE_TIMEOUT: "0.2",
    ...options
  };
  const child = spawn("bash", [resolve(repoRoot, "docker/dst/entrypoint.sh")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  const done = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  fixtures.push({ root, child, done });
  return {
    root, child, done, output: () => output,
    state: () => JSON.parse(readFileSync(env.DST_STATE_FILE, "utf8")),
    health: (stateFile = env.DST_STATE_FILE) => execFileAsync("python3", [resolve(scripts, "dst-supervisor.py"), "--healthcheck"], { env: { ...env, DST_STATE_FILE: stateFile } })
  };
}

async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 3500;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for shard processes");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.child.kill("SIGTERM");
    // Bound cleanup even if process supervision regresses.
    const timer = setTimeout(() => {
      for (const shard of ["Master", "Caves"]) {
        try { process.kill(Number(readFileSync(resolve(fixture.root, `${shard}.pid`), "utf8")), "SIGKILL"); } catch { /* already stopped */ }
      }
      fixture.child.kill("SIGKILL");
    }, 1500);
    await fixture.done;
    clearTimeout(timer);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe("combined DST supervision", () => {
  it("installs once, supervises both shards and saves before stopping", async () => {
    const server = startServer();
    await waitUntil(() => server.output().includes("[Master] Sim paused") && server.output().includes("[Caves] Sim paused"));
    expect(readFileSync(resolve(server.root, "installs"), "utf8")).toBe("install\n");
    expect(server.state()).toMatchObject({ overall: "running", shards: [{ name: "Master", ready: true }, { name: "Caves", ready: true }] });
    await server.health();
    const stale = resolve(server.root, "stale-status.json");
    writeFileSync(stale, JSON.stringify({ ...server.state(), updatedAt: 0 }));
    await expect(server.health(stale)).rejects.toThrow();
    expect(JSON.stringify(server.state())).not.toContain("test-token");
    for (const shard of ["Master", "Caves"]) {
      expect(readFileSync(resolve(server.root, `${shard}.cwd`), "utf8")).toBe(realpathSync(resolve(server.root, "install/bin64")));
      expect(JSON.parse(readFileSync(resolve(server.root, `${shard}.args`), "utf8"))).toEqual([
        "-console", "-persistent_storage_root", resolve(server.root, "cluster"),
        "-conf_dir", "DoNotStarveTogether", "-cluster", "Cluster", "-shard", shard
      ]);
    }
    server.child.kill("SIGTERM");
    expect(await server.done, server.output()).toBe(0);
    for (const shard of ["Master", "Caves"]) {
      expect(readFileSync(resolve(server.root, `${shard}.stopped`), "utf8")).toBe("graceful");
    }
    await expect(server.health()).rejects.toThrow();
  });

  it("starts only Master when caves are disabled and supports the existing offline flag", async () => {
    const server = startServer(false, { DST_SKIP_UPDATE: "1" });
    await waitUntil(() => server.output().includes("[Master] Sim paused"));
    expect(server.state().shards).toHaveLength(1);
    expect(existsSync(resolve(server.root, "Caves.pid"))).toBe(false);
    expect(existsSync(resolve(server.root, "installs"))).toBe(false);
    await server.health();
  });

  it("waits for every enabled shard instead of trusting only Master readiness", async () => {
    const server = startServer(true, { HOLD_READY: "Caves" });
    await waitUntil(() => server.output().includes("[Caves] game ready"));
    expect(server.state()).toMatchObject({ overall: "starting", shards: [{ name: "Master", ready: true }, { name: "Caves", ready: false }] });
    await expect(server.health()).rejects.toThrow();
  });

  it("forces a stuck shard to exit after the shutdown deadline", async () => {
    const server = startServer(false, { IGNORE_STOP: "1" });
    await waitUntil(() => server.output().includes("[Master] Sim paused"));
    const pid = server.state().shards[0].pid;
    server.child.kill("SIGTERM");
    expect(await server.done, server.output()).toBe(0);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(server.state().forced).toBe(true);
  });

  it("seeds a preinstalled image into the existing volume without invoking SteamCMD", async () => {
    const server = startServer(false, { DST_UPDATE_MODE: "image" });
    await waitUntil(() => server.output().includes("[Master] Sim paused"));
    expect(existsSync(resolve(server.root, "installs"))).toBe(false);
    expect(readFileSync(resolve(server.root, "install/version.txt"), "utf8")).toBe("999999");
    expect(server.state().version).toBe("999999");
  });

  it("cancels an in-progress installation when the container stops", async () => {
    const server = startServer(true, { HOLD_INSTALL: "1" });
    await waitUntil(() => server.output().includes("[Setup] installing"));
    server.child.kill("SIGTERM");
    expect(await server.done, server.output()).toBe(0);
    expect(existsSync(resolve(server.root, "Master.pid"))).toBe(false);
    expect(server.state().overall).toBe("stopped");
  });

  it("does not start shards when installation fails", async () => {
    const server = startServer(true, { INSTALL_EXIT: "9" });
    expect(await server.done, server.output()).toBe(9);
    expect(existsSync(resolve(server.root, "Master.pid"))).toBe(false);
  });

  it.each(["Master", "Caves"])("stops the sibling when %s fails and preserves the failure code", async (shard) => {
    const server = startServer(true, { EXIT_SHARD: shard });
    expect(await server.done, server.output()).toBe(7);
    expect(readFileSync(resolve(server.root, `${shard === "Master" ? "Caves" : "Master"}.stopped`), "utf8")).toBe("graceful");
    expect(server.state().overall).toBe("failed");
  });
});
