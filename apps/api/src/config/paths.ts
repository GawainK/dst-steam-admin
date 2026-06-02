import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT_MARKERS = ["pnpm-workspace.yaml", ".git"] as const;
const CURRENT_MODULE_PATH = fileURLToPath(import.meta.url);

function hasRepoRootMarker(directory: string): boolean {
  return REPO_ROOT_MARKERS.some((marker) =>
    existsSync(resolve(directory, marker))
  );
}

export function discoverProjectRootFromModulePath(modulePath: string): string {
  let currentDirectory = dirname(resolve(modulePath));

  while (true) {
    if (hasRepoRootMarker(currentDirectory)) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error(
        `Unable to locate the repository root from module path: ${modulePath}`
      );
    }

    currentDirectory = parentDirectory;
  }
}

const DEFAULT_PROJECT_ROOT = discoverProjectRootFromModulePath(
  CURRENT_MODULE_PATH
);

export function getProjectRoot(): string {
  return resolve(process.env.PROJECT_ROOT ?? DEFAULT_PROJECT_ROOT);
}

export function getDataRoot(projectRoot = getProjectRoot()): string {
  return resolve(projectRoot, "data");
}

export function getClusterRoot(projectRoot = getProjectRoot()): string {
  return resolve(getDataRoot(projectRoot), "cluster");
}

export function getModsRoot(projectRoot = getProjectRoot()): string {
  return resolve(getDataRoot(projectRoot), "mods");
}
