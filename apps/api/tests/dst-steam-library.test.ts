import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
const roots: string[] = [];
const supervisor = resolve(process.cwd(), "../../docker/dst/supervisor.py");
const invoke = `import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("supervisor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.sync_steam_library(Path(sys.argv[2]), Path(sys.argv[3]))
`;

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function library(payload: string, bits = 64) {
  const header = Buffer.alloc(20);
  header.set([0x7f, 0x45, 0x4c, 0x46, bits === 64 ? 2 : 1, 1]);
  header.writeUInt16LE(bits === 64 ? 62 : 3, 18);
  return Buffer.concat([header, Buffer.from(payload)]);
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "dst-steam-library-"));
  roots.push(root);
  const install = resolve(root, "game");
  const steam = resolve(root, "steam");
  const target = resolve(install, "bin64/lib64/steamclient.so");
  const source = resolve(steam, "linux64/steamclient.so");
  const backup = `${target}.before-steamcmd`;
  mkdirSync(resolve(install, "bin64/lib64"), { recursive: true });
  mkdirSync(resolve(steam, "linux64"), { recursive: true });
  writeFileSync(target, library("bundled"));
  return { root, install, steam, target, source, backup,
    sync: (code = invoke) => run("python3", ["-B", "-c", code, supervisor, install, steam]) };
}

it("syncs the 64-bit library, skips identical files, and reapplies after game or SteamCMD updates", async () => {
  const f = fixture();
  const original = readFileSync(f.target);
  writeFileSync(f.source, library("steamcmd-v1"));
  await f.sync();
  expect(readFileSync(f.target)).toEqual(library("steamcmd-v1"));
  expect(readFileSync(f.backup)).toEqual(original);
  await f.sync();
  expect(readFileSync(f.backup)).toEqual(original);
  writeFileSync(f.target, library("game-updated"));
  await f.sync();
  expect(readFileSync(f.target)).toEqual(library("steamcmd-v1"));
  expect(readFileSync(f.backup)).toEqual(library("game-updated"));
  writeFileSync(f.source, library("steamcmd-v2"));
  await f.sync();
  expect(readFileSync(f.target)).toEqual(library("steamcmd-v2"));
  expect(readFileSync(f.backup)).toEqual(library("steamcmd-v1"));
  expect(readdirSync(resolve(f.install, "bin64/lib64"))).toEqual(["steamclient.so", "steamclient.so.before-steamcmd"]);
});

it("keeps the current library for offline installations without a SteamCMD 64-bit library", async () => {
  const f = fixture();
  mkdirSync(resolve(f.steam, "linux32"));
  writeFileSync(resolve(f.steam, "linux32/steamclient.so"), library("32-bit", 32));
  const { stdout } = await f.sync();
  expect(stdout).toContain("64-bit library unavailable");
  expect(readFileSync(f.target)).toEqual(library("bundled"));
  expect(existsSync(f.backup)).toBe(false);
});

it.each([library("wrong-architecture", 32), Buffer.from("partial download")])("rejects an invalid source before changing the game library (%#)", async (source) => {
  const f = fixture();
  writeFileSync(f.source, source);
  await expect(f.sync()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("ELF x86-64") });
  expect(readFileSync(f.target)).toEqual(library("bundled"));
  expect(existsSync(f.backup)).toBe(false);
});

it("restores a missing game library from the valid SteamCMD copy", async () => {
  const f = fixture();
  rmSync(resolve(f.install, "bin64/lib64"), { recursive: true });
  writeFileSync(f.source, library("steamcmd"));
  await f.sync();
  expect(readFileSync(f.target)).toEqual(library("steamcmd"));
  expect(existsSync(f.backup)).toBe(false);
});

it("leaves the current library intact and cleans temporary files when replacement fails", async () => {
  const f = fixture();
  writeFileSync(f.source, library("steamcmd"));
  const code = invoke.replace("module.sync_steam_library", `
original_copy = module.shutil.copy2
def interrupted_copy(source, destination, *args, **kwargs):
    if Path(source) == Path(sys.argv[3]) / "linux64/steamclient.so":
        Path(destination).write_bytes(b"interrupted")
        raise OSError("simulated failed copy")
    return original_copy(source, destination, *args, **kwargs)
module.shutil.copy2 = interrupted_copy
module.sync_steam_library`);
  await expect(f.sync(code)).rejects.toMatchObject({ code: 1 });
  expect(readFileSync(f.target)).toEqual(library("bundled"));
  expect(readFileSync(f.backup)).toEqual(library("bundled"));
  expect(readdirSync(resolve(f.install, "bin64/lib64"))).toEqual(["steamclient.so", "steamclient.so.before-steamcmd"]);
});
