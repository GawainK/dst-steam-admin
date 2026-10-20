import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(installedBuild?: string) {
  const root = mkdtempSync(resolve(tmpdir(), "dst-runtime-install-"));
  roots.push(root);
  const install = resolve(root, "game");
  const steam = resolve(root, "steam");
  const binary = resolve(install, "bin64/dontstarve_dedicated_server_nullrenderer_x64");
  const manifest = resolve(install, "steamapps/appmanifest_343050.acf");
  mkdirSync(steam);
  if (installedBuild) {
    mkdirSync(resolve(install, "bin64"), { recursive: true });
    mkdirSync(resolve(install, "steamapps"));
    writeFileSync(binary, "#!/bin/sh\n# existing server\n", { mode: 0o755 });
    writeFileSync(manifest, `"buildid" "${installedBuild}"\n`);
  }
  // Substitute only the Steam network/download boundary; execute the real installer.
  writeFileSync(resolve(steam, "steamcmd.sh"), `#!/bin/sh
set -eu
case " $* " in
  *" +app_info_print 343050 "*)
    printf '"public"\\n"buildid" "%s"\\n' "$TEST_LATEST_BUILD"
    ;;
  *" +app_update 343050 "*)
    test "$1" = +force_install_dir
    target="$2"
    mkdir -p "$target/bin64" "$target/steamapps"
    printf '#!/bin/sh\\n# downloaded build %s\\n' "$TEST_LATEST_BUILD" > "$target/bin64/dontstarve_dedicated_server_nullrenderer_x64"
    chmod +x "$target/bin64/dontstarve_dedicated_server_nullrenderer_x64"
    printf '"buildid" "%s"\\n' "$TEST_LATEST_BUILD" > "$target/steamapps/appmanifest_343050.acf"
    printf '%s\\n' "$TEST_LATEST_BUILD" >> "$TEST_ROOT/downloads"
    ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  return {
    root, install, binary, manifest,
    start: (latest: string) => run("sh", ["../../docker/dst/install-server.sh"], { env: {
      ...process.env, DST_INSTALL_ROOT: install, DST_STEAMCMD_ROOT: steam,
      TEST_ROOT: root, TEST_LATEST_BUILD: latest
    } })
  };
}

it("downloads the first installation into the server directory and reuses it on the next start", async () => {
  const server = fixture();
  await server.start("123");
  expect(readFileSync(server.binary, "utf8")).toContain("downloaded build 123");
  expect(readFileSync(server.manifest, "utf8")).toContain('"123"');
  const { stdout } = await server.start("123");
  expect(stdout).toContain("skipping update");
  expect(readFileSync(resolve(server.root, "downloads"), "utf8")).toBe("123\n");
});

it("updates an older installation in place and retains local mod files", async () => {
  const server = fixture("123");
  mkdirSync(resolve(server.install, "mods"));
  const mod = resolve(server.install, "mods/dedicated_server_mods_setup.lua");
  writeFileSync(mod, "ServerModSetup('workshop-1')\n");
  const { stdout } = await server.start("456");
  expect(stdout).toContain("installed=123 latest=456");
  expect(readFileSync(server.binary, "utf8")).toContain("downloaded build 456");
  expect(readFileSync(server.manifest, "utf8")).toContain('"456"');
  expect(readFileSync(mod, "utf8")).toBe("ServerModSetup('workshop-1')\n");
  await server.start("456");
  expect(readFileSync(resolve(server.root, "downloads"), "utf8")).toBe("456\n");
});

it("repairs a missing server executable even when its manifest is already current", async () => {
  const server = fixture("123");
  rmSync(server.binary);
  await server.start("123");
  expect(readFileSync(server.binary, "utf8")).toContain("downloaded build 123");
});
