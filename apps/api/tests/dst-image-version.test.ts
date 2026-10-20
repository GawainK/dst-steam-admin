import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("extracts only the public Steam Build ID and writes safe workflow outputs", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "dst-image-version-"));
  roots.push(root);
  const input = resolve(root, "info.json");
  const output = resolve(root, "outputs");
  writeFileSync(input, JSON.stringify({ status: "success", data: { "343050": { depots: { branches: {
    public: { buildid: "123456", timeupdated: "1770000000" }, beta: { buildid: "999999" }
  } } } } }));
  const result = await execFileAsync(process.execPath, ["../../scripts/dst/image-version.mjs"], {
    env: { ...process.env, DST_VERSION_INFO_FILE: input, GITHUB_OUTPUT: output }
  });
  expect(JSON.parse(result.stdout)).toEqual({ buildId: "123456", timeUpdated: "1770000000" });
  expect(readFileSync(output, "utf8")).toBe("build_id=123456\ntime_updated=1770000000\n");
});

it.each([{}, { status: "success", data: { "343050": { depots: { branches: { public: { buildid: "123\nINJECT=1" } } } } } }])("refuses incomplete or unsafe Steam metadata", async (data) => {
  const root = mkdtempSync(resolve(tmpdir(), "dst-image-version-"));
  roots.push(root);
  const input = resolve(root, "info.json");
  writeFileSync(input, JSON.stringify(data));
  await expect(execFileAsync(process.execPath, ["../../scripts/dst/image-version.mjs"], {
    env: { ...process.env, DST_VERSION_INFO_FILE: input }
  })).rejects.toThrow();
});
