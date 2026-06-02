import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import {
  buildComposeCommand,
  runCompose,
  sanitizeLogLines
} from "../src/docker/compose.js";
import {
  discoverProjectRootFromModulePath,
  getProjectRoot
} from "../src/config/paths.js";

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
}

function createComposeFixture() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "compose-cwd-"));
  const projectRoot = resolve(tempRoot, "project");
  const composeDir = resolve(projectRoot, "docker");
  const outsideRoot = resolve(tempRoot, "outside");

  mkdirSync(composeDir, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });

  return {
    composeDir,
    outsideRoot,
    projectRoot,
    cleanup() {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  };
}

afterEach(() => {
  spawnMock.mockReset();
  vi.unstubAllEnvs();
});

describe("buildComposeCommand", () => {
  it("maps start to the fixed compose command", () => {
    expect(buildComposeCommand("start")).toEqual({
      command: "docker",
      args: ["compose", "up", "-d", "dst-master", "dst-caves"]
    });
  });

  it("maps stop and restart without accepting arbitrary shell input", () => {
    expect(buildComposeCommand("stop", "200; rm -rf /")).toEqual({
      command: "docker",
      args: ["compose", "stop", "dst-master", "dst-caves"]
    });

    expect(buildComposeCommand("restart", "$(touch hacked)")).toEqual({
      command: "docker",
      args: ["compose", "restart", "dst-master", "dst-caves"]
    });
  });

  it("maps status and logs to fixed compose arguments", () => {
    expect(buildComposeCommand("status")).toEqual({
      command: "docker",
      args: ["compose", "ps", "-a", "--format", "json"]
    });

    expect(buildComposeCommand("logs", "20")).toEqual({
      command: "docker",
      args: ["compose", "logs", "--tail", "20", "dst-master", "dst-caves"]
    });
  });
});

describe("sanitizeLogLines", () => {
  it("clamps and defaults log line input", () => {
    expect(sanitizeLogLines("20")).toBe(20);
    expect(sanitizeLogLines("20junk")).toBe(200);
    expect(sanitizeLogLines("9999")).toBe(1000);
    expect(sanitizeLogLines("abc")).toBe(200);
  });
});

describe("getProjectRoot", () => {
  const expectedProjectRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );

  it("prefers PROJECT_ROOT over the module-location fallback", () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/env-project-root");

    expect(getProjectRoot()).toBe("/tmp/env-project-root");
    expect(getProjectRoot()).not.toBe(expectedProjectRoot);
  });

  it("finds the repo root from a source-like module path", () => {
    const sourceModulePath = resolve(
      expectedProjectRoot,
      "apps/api/src/config/paths.ts"
    );

    expect(discoverProjectRootFromModulePath(sourceModulePath)).toBe(
      expectedProjectRoot
    );
  });

  it("finds the repo root from a built-output-like module path", () => {
    const builtModulePath = resolve(
      expectedProjectRoot,
      "apps/api/dist/src/config/paths.js"
    );

    expect(discoverProjectRootFromModulePath(builtModulePath)).toBe(
      expectedProjectRoot
    );
  });

  it("derives the repo root from the module location when PROJECT_ROOT is unset and cwd is outside the repo", () => {
    const originalCwd = process.cwd();
    const outsideCwd = mkdtempSync(resolve(tmpdir(), "project-root-cwd-"));

    try {
      process.chdir(outsideCwd);

      expect(getProjectRoot()).toBe(expectedProjectRoot);
    } finally {
      process.chdir(originalCwd);
      rmSync(outsideCwd, { force: true, recursive: true });
    }
  });
});

describe("runCompose", () => {
  it("rejects cwd values outside the project root", async () => {
    const fixture = createComposeFixture();
    vi.stubEnv("PROJECT_ROOT", fixture.projectRoot);

    try {
      await expect(runCompose("status", fixture.outsideRoot)).rejects.toThrow(
        "docker compose status failed: cwd must stay within the project root"
      );
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects cwd values that escape the project root through symlinks", async () => {
    const fixture = createComposeFixture();
    const escapedCwd = resolve(fixture.projectRoot, "compose-link");
    symlinkSync(fixture.outsideRoot, escapedCwd, "dir");

    vi.stubEnv("PROJECT_ROOT", fixture.projectRoot);

    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);

    try {
      const pending = runCompose("status", escapedCwd);
      child.emit("close", 0);

      await expect(pending).rejects.toThrow(
        "docker compose status failed: cwd must stay within the project root"
      );
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it("surfaces stderr when docker compose exits with an error", async () => {
    const fixture = createComposeFixture();
    vi.stubEnv("PROJECT_ROOT", fixture.projectRoot);

    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);

    try {
      const pending = runCompose("status", fixture.composeDir);
      child.stderr.write("permission denied\n");
      child.emit("close", 1);

      await expect(pending).rejects.toThrow(
        "docker compose status failed: permission denied"
      );
      expect(spawnMock).toHaveBeenCalledWith(
        "docker",
        ["compose", "ps", "-a", "--format", "json"],
        expect.objectContaining({ cwd: realpathSync(fixture.composeDir) })
      );
    } finally {
      fixture.cleanup();
    }
  });
});
