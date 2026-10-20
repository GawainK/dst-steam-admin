import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { getServerCheck } from "../src/server/check.js";

const image = "ghcr.io/gawaink/dst-steam-admin/dst-server:sha-b27bd98d4a47";
const ids = "831523966 1200745268 2287303119 1909182187 2847908822 623749604 604761020 2753774601 2078243581 362175979 1185229307 1207269058 3753319890 3760106287 378160973".split(" ");
const containerId = "a".repeat(64);
let currentImage: string;
let running: boolean;
let state: Record<string, unknown>;
let logs: string;
let healthError: Error | null;
let logError: Error | null;
let missing: boolean;

beforeEach(() => {
  vi.stubEnv("DST_GAME_IMAGE", "");
  currentImage = image;
  running = true;
  missing = false;
  healthError = null;
  logError = null;
  state = {
    pid: 7, updatedAt: Date.now() / 1000, overall: "running", version: "756039",
    shards: ["Master", "Caves"].map((name, index) => ({ name, pid: 10 + index, ready: true, exitCode: null }))
  };
  logs = "[Master] [Shard] Secondary Caves(2) ready!\n[Caves] [Shard] secondary shard LUA is now ready!\n";
  logs += ["Master", "Caves"].flatMap((shard) => ids.map((id) =>
    `[${shard}] [00:00:20]: Mod: workshop-${id} (Title) Loading modmain.lua`
  )).join("\n");
  execFileMock.mockReset();
  execFileMock.mockImplementation((_command, args, _options, callback) => {
    if (args[0] === "compose") callback(null, missing ? "" : containerId, "");
    else if (args[0] === "inspect") callback(null, JSON.stringify([{
      Id: containerId, Image: "sha256:runtime", Config: { Image: currentImage, Env: ["SECRET=do-not-return"] },
      State: { Running: running, OOMKilled: false, StartedAt: new Date(Date.now() - 60_000).toISOString(), Health: { Status: "healthy" } }
    }]), "");
    else if (args[0] === "logs") callback(logError, logs, "");
    else if (args.includes("--healthcheck")) callback(healthError, "", "");
    else if (args[0] === "exec") callback(null, JSON.stringify(state), "");
    else throw new Error(`Unexpected command: ${args.join(" ")}`);
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("server check", () => {
  it("reports the current image, live shards and all 15 loaded mods without returning secrets", async () => {
    const report = await getServerCheck(process.cwd());
    expect(report.overall).toBe("pass");
    expect(report.image.current).toBe(image);
    expect(report.mods).toHaveLength(15);
    expect(report.mods.every((mod) => mod.master === "pass" && mod.caves === "pass")).toBe(true);
    expect(report.shards.map((shard) => shard.loadedMods)).toEqual([15, 15]);
    expect(JSON.stringify(report)).not.toMatch(/do-not-return|SECRET|Config/);
    const logArgs = execFileMock.mock.calls.find(([, args]) => args[0] === "logs")![1];
    expect(logArgs).toContain("--since");
    for (const [command, args, options] of execFileMock.mock.calls) {
      expect(command).toBe("docker");
      expect(options.shell).toBe(false);
      expect(options.timeout).toBeGreaterThan(0);
      expect(["compose", "inspect", "logs", "exec"]).toContain(args[0]);
    }
  });

  it("does not count a download callback as a Caves mod load", async () => {
    logs = logs.replace("[Caves] [00:00:20]: Mod: workshop-378160973 (Title) Loading modmain.lua", "[Caves] [Workshop] OnDownloadPublishedFile [1] 378160973");
    const report = await getServerCheck(process.cwd());
    expect(report.overall).toBe("check");
    expect(report.mods.find((mod) => mod.id === "378160973")).toMatchObject({ master: "pass", caves: "unknown" });
    expect(report.shards[1].loadedMods).toBe(14);
  });

  it("rejects a different runtime image", async () => {
    currentImage = "old-runtime:latest";
    const report = await getServerCheck(process.cwd());
    expect(report.overall).toBe("check");
    expect(report.items.find((item) => item.key === "image")?.status).toBe("check");
  });

  it("uses the deployed target image instead of reporting newer versions as old", async () => {
    currentImage = "dst-steam-admin-dst-server:local-new-version";
    vi.stubEnv("DST_GAME_IMAGE", currentImage);
    const report = await getServerCheck(process.cwd());
    expect(report.image.expected).toBe(currentImage);
    expect(report.overall).toBe("pass");
  });

  it.each(["stale", "dead", "not-ready", "disconnected", "lua-error"])("does not pass %s", async (failure) => {
    if (failure === "stale") state.updatedAt = Date.now() / 1000 - 20;
    if (failure === "dead") healthError = new Error("dead process");
    if (failure === "not-ready") (state.shards as { ready: boolean }[])[1].ready = false;
    if (failure === "disconnected") logs += "\n[Caves] [Shard] Disconnected from master";
    if (failure === "lua-error") logs += "\n[Caves] LUA ERROR stack traceback:";
    expect((await getServerCheck(process.cwd())).overall).toBe("check");
  });

  it("keeps the image visible for stopped containers and does not execute inside them", async () => {
    running = false;
    const report = await getServerCheck(process.cwd());
    expect(report.image.current).toBe(image);
    expect(report.overall).toBe("check");
    expect(report.mods.every((mod) => mod.master === "unknown")).toBe(true);
    expect(execFileMock.mock.calls.some(([, args]) => args[0] === "exec")).toBe(false);
  });

  it("reports missing containers without inventing successful checks", async () => {
    missing = true;
    const report = await getServerCheck(process.cwd());
    expect(report.overall).toBe("check");
    expect(report.image.current).toBeNull();
    expect(report.mods).toHaveLength(15);
  });

  it("retains live shard results when logs cannot be read and does not expose errors", async () => {
    logError = new Error("SECRET=do-not-return");
    const report = await getServerCheck(process.cwd());
    expect(report.overall).toBe("check");
    expect(report.shards[0].status).toBe("pass");
    expect(report.mods.every((mod) => mod.master === "unknown")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("do-not-return");
  });

  it("marks Caves as disabled when the running supervisor owns only Master", async () => {
    state.shards = (state.shards as { name: string }[]).filter((shard) => shard.name === "Master");
    const report = await getServerCheck(process.cwd());
    expect(report.overall).toBe("pass");
    expect(report.shards[1].status).toBe("skipped");
    expect(report.mods.every((mod) => mod.caves === "skipped")).toBe(true);
  });
});
