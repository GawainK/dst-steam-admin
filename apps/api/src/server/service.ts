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

export async function getServerStatus(projectRoot: string) {
  const result = await runCompose("status", projectRoot);
  const status = parseComposeStatus(result.stdout);

  // Containers report "running" the instant docker restarts them, but the DST process
  // inside still needs minutes to load the world and connect shards. Confirm readiness
  // from the logs before reporting "running"; otherwise surface "starting".
  if (status.overall === "running") {
    const logs = await runCompose("logs", projectRoot, "1000");
    if (!isServerReady(logs.stdout, readyMarkersFromEnv())) {
      return { ...status, overall: "starting" as const };
    }
  }

  return status;
}

export async function runServerAction(
  projectRoot: string,
  action: "start" | "stop" | "restart"
) {
  await runCompose(action, projectRoot, undefined);
}

export async function getServerLogs(projectRoot: string, lines?: string) {
  const result = await runCompose("logs", projectRoot, lines);
  return {
    content: result.stdout
  };
}
