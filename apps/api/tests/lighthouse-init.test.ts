import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(packages = "", removeFails = false) {
  const root = mkdtempSync(resolve(tmpdir(), "lighthouse-init-"));
  roots.push(root);
  const bin = resolve(root, "bin");
  const commands = resolve(root, "commands");
  mkdirSync(bin);
  const osRelease = resolve(root, "os-release");
  writeFileSync(osRelease, "ID=ubuntu\nVERSION_CODENAME=noble\n");
  // Replace only the OS file boundary; all privileged operations are intercepted.
  const source = readFileSync("../../scripts/init-tencent-lighthouse.sh", "utf8");
  const script = resolve(root, "init.sh");
  writeFileSync(script, source.replaceAll("/etc/os-release", osRelease));
  writeFileSync(resolve(bin, "dpkg"), `#!/bin/bash
if [[ "$1" == --get-selections ]]; then
  shift
  for package in "$@"; do
    if [[ " $TEST_PACKAGES " == *" $package "* ]]; then printf '%s\\tinstall\\n' "$package"; fi
  done
elif [[ "$1" == --print-architecture ]]; then
  echo amd64
else
  exit 2
fi
`, { mode: 0o755 });
  writeFileSync(resolve(bin, "curl"), "#!/bin/sh\nprintf 'test-key\\n'\n", { mode: 0o755 });
  writeFileSync(resolve(bin, "sudo"), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
if [[ "$1 $2" == "apt remove" ]]; then
  if [[ "$TEST_REMOVE_FAILS" == 1 ]]; then exit 23; fi
  touch "$TEST_REMOVED"
elif [[ "$1 $2" == "apt install" && -n "$TEST_PACKAGES" && ! -f "$TEST_REMOVED" ]]; then
  echo 'conflicting distro package is still installed' >&2
  exit 21
elif [[ "$1" == gpg || "$1" == tee ]]; then
  cat > /dev/null
fi
`, { mode: 0o755 });
  return {
    commands: () => readFileSync(commands, "utf8"),
    start: () => run("bash", [script], { env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, TARGET_USER: "ubuntu",
      TEST_PACKAGES: packages, TEST_COMMANDS: commands,
      TEST_REMOVED: resolve(root, "removed"), TEST_REMOVE_FAILS: removeFails ? "1" : "0"
    } })
  };
}

it("removes the installed Compose conflict before any apt install", async () => {
  const server = fixture("docker-compose-v2");
  await server.start();
  const commands = server.commands();
  expect(commands).toContain("apt remove -y docker-compose-v2\n");
  expect(commands.indexOf("apt remove")).toBeLessThan(commands.indexOf("apt install"));
  expect(commands).toContain("apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin");
  expect(commands).toContain("usermod -aG docker ubuntu");
});

it("does not run apt remove when no conflicting packages are installed", async () => {
  const server = fixture();
  await server.start();
  expect(server.commands()).not.toContain("apt remove");
});

it("removes only detected distro conflicts and stops if removal fails", async () => {
  const server = fixture("docker.io docker-buildx containerd runc", true);
  await expect(server.start()).rejects.toMatchObject({ code: 23 });
  expect(server.commands()).toContain("apt remove -y docker.io docker-buildx containerd runc\n");
  expect(server.commands()).not.toContain("apt install");
  expect(server.commands()).not.toContain("usermod");
});
