import { promises as fs } from "node:fs";
import { resolve } from "node:path";

function getSetupPath(projectRoot: string) {
  return resolve(projectRoot, "data/mods/dedicated_server_mods_setup.lua");
}

function getOverridesPath(projectRoot: string) {
  return resolve(projectRoot, "data/mods/modoverrides.lua");
}

async function readTextOrDefault(path: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

export async function readModFiles(projectRoot: string) {
  return {
    setup: await readTextOrDefault(getSetupPath(projectRoot), ""),
    overrides: await readTextOrDefault(getOverridesPath(projectRoot), "return {}\n")
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
