import { runCompose } from "../docker/compose.js";
import { parseComposeStatus } from "../docker/status.js";

export async function getServerStatus(projectRoot: string) {
  const result = await runCompose("status", projectRoot);
  return parseComposeStatus(result.stdout);
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
