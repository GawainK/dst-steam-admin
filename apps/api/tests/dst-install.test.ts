import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
const run = promisify(execFile);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("refuses to label an image with a different Build ID than the game actually installed", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "dst-build-check-"));
  roots.push(root);
  const install = resolve(root, "game");
  const steam = resolve(root, "steam");
  mkdirSync(resolve(install, "bin64"), { recursive: true });
  mkdirSync(resolve(install, "steamapps"));
  mkdirSync(steam);
  writeFileSync(resolve(install, "bin64/dontstarve_dedicated_server_nullrenderer_x64"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(resolve(install, "steamapps/appmanifest_343050.acf"), '"buildid" "123"\n');
  writeFileSync(resolve(steam, "steamcmd.sh"), '#!/bin/sh\nprintf \'"public"\\n"buildid" "123"\\n\'\n', { mode: 0o755 });
  await expect(run("sh", ["../../docker/dst/install-server.sh"], { env: {
    ...process.env, DST_INSTALL_ROOT: install, DST_STEAMCMD_ROOT: steam, DST_EXPECTED_BUILD_ID: "999"
  } })).rejects.toMatchObject({ code: 1 });
});
