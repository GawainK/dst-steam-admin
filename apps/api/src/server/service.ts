import { runCompose } from "../docker/compose.js";
import { isServerReady, parseComposeStatus } from "../docker/status.js";

function readyMarkersFromEnv(): string[] | undefined {
  const raw = process.env.DST_READY_MARKERS;
  if (!raw) {
    return undefined;
  }

  const markers = raw
    .split(/[,\n]/)
    .map((marker) => marker.trim())
    .filter(Boolean);

  return markers.length > 0 ? markers : undefined;
}

let readyLatched = false;

// 仅供测试：重置就绪 latch
export function __resetReadyLatch(): void {
  readyLatched = false;
}

export async function getServerStatus(projectRoot: string) {
  const result = await runCompose("status", projectRoot);
  const status = parseComposeStatus(result.stdout);

  // 容器一旦不再全部运行，下一轮必须重新判定就绪
  if (status.overall !== "running") {
    readyLatched = false;
    return status;
  }

  // New images evaluate every enabled shard internally. Always read current
  // health, even if a previous container run was already latched as ready.
  const health = status.containers[0]?.health;
  if (health) {
    readyLatched = false;
    return {
      ...status,
      overall: health === "healthy" ? "running" as const
        : health === "unhealthy" ? "partial" as const : "starting" as const
    };
  }

  // 已确认就绪：稳态下跳过昂贵的日志扫描
  if (readyLatched) {
    return status;
  }

  // 容器 running 但游戏进程可能仍在加载世界，读日志确认就绪标记
  const logs = await runCompose("logs", projectRoot, "1000");
  if (isServerReady(logs.stdout, readyMarkersFromEnv())) {
    readyLatched = true;
    return status;
  }

  return { ...status, overall: "starting" as const };
}

export async function runServerAction(
  projectRoot: string,
  action: "start" | "stop" | "restart"
) {
  await runCompose(action, projectRoot);
  // 用户主动启停后强制下一轮重新判定就绪
  readyLatched = false;
}

export async function getServerLogs(projectRoot: string, lines?: string) {
  const result = await runCompose("logs", projectRoot, lines);
  return {
    content: result.stdout
  };
}
