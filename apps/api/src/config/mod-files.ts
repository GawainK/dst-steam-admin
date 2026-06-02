import { promises as fs } from "node:fs";
import { resolve } from "node:path";

function getSetupPath(projectRoot: string) {
  return resolve(projectRoot, "data/mods/dedicated_server_mods_setup.lua");
}

function getOverridesPath(projectRoot: string) {
  return resolve(projectRoot, "data/mods/modoverrides.lua");
}

export async function readModFiles(projectRoot: string) {
  return {
    setup: await fs.readFile(getSetupPath(projectRoot), "utf8"),
    overrides: await fs.readFile(getOverridesPath(projectRoot), "utf8")
  };
}

export async function writeModFiles(
  projectRoot: string,
  input: { setup: string; overrides: string }
) {
  await fs.mkdir(resolve(projectRoot, "data/mods"), { recursive: true });
  await Promise.all([
    fs.writeFile(getSetupPath(projectRoot), input.setup),
    fs.writeFile(getOverridesPath(projectRoot), input.overrides)
  ]);
}
