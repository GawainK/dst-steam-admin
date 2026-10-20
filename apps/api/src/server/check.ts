import { execFile } from "node:child_process";
import { z } from "zod";

import { resolveComposeCwd } from "../docker/compose.js";

export type CheckStatus = "pass" | "check" | "unknown" | "skipped";
type ShardName = "Master" | "Caves";

export interface ServerCheckReport {
  checkedAt: string;
  overall: "pass" | "check";
  image: { current: string | null; expected: string; id: string | null };
  version: string | null;
  items: { key: string; label: string; status: CheckStatus; detail: string }[];
  shards: { name: ShardName; status: CheckStatus; pid: number | null; ready: boolean; loadedMods: number }[];
  mods: { id: string; master: CheckStatus; caves: CheckStatus }[];
}

// The deployed image comes from Compose; retain the CLI default for local dev.
const EXPECTED_IMAGE = "ghcr.io/gawaink/dst-steam-admin/dst-server:sha-b27bd98d4a47";
const MOD_IDS = "831523966 1200745268 2287303119 1909182187 2847908822 623749604 604761020 2753774601 2078243581 362175979 1185229307 1207269058 3753319890 3760106287 378160973".split(" ");
const SHARDS: ShardName[] = ["Master", "Caves"];
const snapshotSchema = z.object({
  pid: z.number().int().positive(),
  updatedAt: z.number(),
  overall: z.string(),
  version: z.string().nullable().optional(),
  shards: z.array(z.object({
    name: z.enum(["Master", "Caves"]),
    pid: z.number().int().positive(),
    ready: z.boolean(),
    exitCode: z.number().nullable()
  }))
});
const inspectSchema = z.array(z.object({
  Id: z.string(),
  Image: z.string(),
  Config: z.object({ Image: z.string() }),
  State: z.object({
    Running: z.boolean(),
    OOMKilled: z.boolean().optional(),
    StartedAt: z.string(),
    Health: z.object({ Status: z.string() }).optional()
  })
})).length(1);

function docker(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, {
      cwd, shell: false, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function lastMatch(pattern: string, text: string): number {
  return Array.from(text.matchAll(new RegExp(pattern, "gi"))).at(-1)?.index ?? -1;
}

export async function getServerCheck(projectRoot: string): Promise<ServerCheckReport> {
  const expectedImage = process.env.DST_GAME_IMAGE?.trim() || EXPECTED_IMAGE;
  const report: ServerCheckReport = {
    checkedAt: new Date().toISOString(), overall: "check",
    image: { current: null, expected: expectedImage, id: null }, version: null,
    items: [],
    shards: SHARDS.map((name) => ({ name, status: "unknown", pid: null, ready: false, loadedMods: 0 })),
    mods: MOD_IDS.map((id) => ({ id, master: "unknown", caves: "unknown" }))
  };
  const add = (key: string, label: string, status: CheckStatus, detail: string) => {
    report.items.push({ key, label, status, detail });
  };
  try {
    const cwd = resolveComposeCwd("status", projectRoot);
    const result = await docker(["compose", "ps", "-a", "-q", "dst-server"], cwd);
    const id = result.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/i.test(id)) {
      add("container", "游戏容器", "unknown", "未找到唯一的 dst-server 容器，请检查部署和 Docker 权限。");
      return report;
    }
    const inspected = await docker(["inspect", id], cwd);
    const parsed = inspectSchema.safeParse(parseJson(inspected.stdout));
    if (!parsed.success) throw new Error("Invalid container snapshot");
    const container = parsed.data[0];
    report.image.current = container.Config.Image;
    report.image.id = container.Image;
    add("image", "运行镜像", container.Config.Image === expectedImage ? "pass" : "check",
      container.Config.Image === expectedImage ? "与本次更新的预期镜像一致。" : "当前标签与本次更新的预期镜像不同，请核对版本。");
    const running = container.State.Running && !container.State.OOMKilled;
    add("container", "游戏容器", running ? "pass" : "check",
      running ? "容器正在运行。" : "容器未运行或被内存不足终止；分片和模组尚无法确认。");
    add("health", "Docker 健康状态", running && container.State.Health?.Status === "healthy" ? "pass" : "check",
      container.State.Health?.Status ?? "未提供健康状态");
    if (!running) return report;
    const since = container.State.StartedAt;
    if (!Number.isFinite(Date.parse(since))) throw new Error("Invalid start timestamp");

    const [stateResult, healthResult, logResult] = await Promise.allSettled([
      docker(["exec", id, "cat", "/run/dst/status.json"], cwd),
      docker(["exec", id, "python3", "/usr/local/bin/dst-supervisor.py", "--healthcheck"], cwd),
      docker(["logs", "--since", since, id], cwd)
    ]);
    const stateParsed = snapshotSchema.safeParse(stateResult.status === "fulfilled" ? parseJson(stateResult.value.stdout) : null);
    const state = stateParsed.success ? stateParsed.data : null;
    const age = state ? Date.now() - state.updatedAt * 1000 : Infinity;
    const fresh = state !== null && age >= 0 && age < 10_000 && state.updatedAt * 1000 >= Date.parse(since);
    const live = fresh && healthResult.status === "fulfilled";
    report.version = state?.version ?? null;
    add("supervisor", "分片监督器", fresh && state?.overall === "running" ? "pass" : state ? "check" : "unknown",
      !state ? "无法读取有效的状态文件。" : !fresh ? "状态心跳过期或不属于本次启动。" : `当前状态：${state.overall}`);
    add("processes", "心跳与进程存活", live ? "pass" : "check",
      live ? "监督器与启用分片的进程存活，心跳有效。" : "进程健康检查未通过，可能仍在启动或已退出。");

    // The live supervisor is authoritative about whether Caves was started.
    const cavesDisabled = fresh && state?.overall === "running" && state.shards.length === 1 && state.shards[0].name === "Master";
    for (const shard of report.shards) {
      const found = state?.shards.find((entry) => entry.name === shard.name);
      shard.pid = found?.pid ?? null;
      shard.ready = found?.ready === true;
      shard.status = shard.name === "Caves" && cavesDisabled ? "skipped"
        : !state ? "unknown" : live && found?.ready && found.exitCode === null ? "pass" : "check";
    }

    const logAvailable = logResult.status === "fulfilled";
    const log = logAvailable ? `${logResult.value.stdout}\n${logResult.value.stderr}` : "";
    const shardLogs = Object.fromEntries(SHARDS.map((name) => [name,
      log.split(/\r?\n/).filter((line) => line.startsWith(`[${name}]`)).join("\n")
    ])) as Record<ShardName, string>;
    add("logs", "本次启动日志", logAvailable ? "pass" : "unknown",
      logAvailable ? `仅使用 ${since} 之后的日志。` : "日志读取失败、超时或输出过大，模组加载证据不足。");
    const patterns = {
      Master: "\\[Shard\\].*Secondary Caves\\(2\\) ready!",
      Caves: "\\[Shard\\].*secondary shard LUA is now ready!"
    };
    const linked = SHARDS.every((name) => {
      const ready = lastMatch(patterns[name], shardLogs[name]);
      const lost = lastMatch("\\[Shard\\].*(?:disconnect|lost connection|connection.*lost)", shardLogs[name]);
      return ready >= 0 && ready > lost;
    });
    add("binding", "地面与洞穴连接", cavesDisabled ? "skipped" : !logAvailable ? "unknown" : linked ? "pass" : "unknown",
      cavesDisabled ? "本次运行未启用洞穴。" : linked ? "两侧已完成连接，就绪后无分片断连记录。" : "未确认两侧连接，可能仍在启动、发生断连或日志已轮转。");
    const luaError = /LUA ERROR|MOD ERROR|stack traceback:|Error loading mod|Failed to load mod/i.test(log);
    add("lua", "Lua 与模组错误", !logAvailable ? "unknown" : luaError ? "check" : "pass",
      !logAvailable ? "日志不足，无法确认。" : luaError ? "本次启动日志存在 Lua 或模组报错，请查看实时日志。" : "本次可读取日志未发现 Lua 或模组报错。");
    for (const mod of report.mods) {
      for (const name of SHARDS) {
        const key = name === "Master" ? "master" : "caves";
        mod[key] = name === "Caves" && cavesDisabled ? "skipped"
          : new RegExp(`\\bMod:\\s*workshop-${mod.id}(?!\\d)[^\\n]*\\bLoading\\s+mod(?:main|worldgenmain)\\.lua\\b`, "i").test(shardLogs[name]) ? "pass" : "unknown";
      }
    }
    for (const shard of report.shards) {
      shard.loadedMods = report.mods.filter((mod) => mod[shard.name === "Master" ? "master" : "caves"] === "pass").length;
    }
    const accepted = (status: CheckStatus) => status === "pass" || status === "skipped";
    report.overall = report.items.every((item) => accepted(item.status)) && report.shards.every((shard) => accepted(shard.status))
      && report.mods.every((mod) => accepted(mod.master) && accepted(mod.caves)) ? "pass" : "check";
    return report;
  } catch {
    // Never return Docker stderr, inspect Env, raw logs, or configuration secrets.
    add("collection", "检查数据采集", "unknown", "无法完成检查，请确认 Docker 服务、Compose 部署及访问权限。");
    return report;
  }
}
