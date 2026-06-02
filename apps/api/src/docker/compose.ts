import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { getProjectRoot } from "../config/paths.js";

export type ServerAction = "start" | "stop" | "restart" | "status" | "logs";

export interface ComposeCommand {
  command: string;
  args: string[];
}

export interface ComposeRunResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 1000;
const DST_SERVICES = ["dst-master", "dst-caves"] as const;

function resolveComposeCwd(action: ServerAction, cwd: string): string {
  const projectRoot = realpathSync(resolve(getProjectRoot()));
  const composeCwd = realpathSync(resolve(cwd));
  const relativePath = relative(projectRoot, composeCwd);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return composeCwd;
  }

  throw new Error(`docker compose ${action} failed: cwd must stay within the project root`);
}

export function sanitizeLogLines(value?: string): number {
  const normalized = value?.trim() ?? "";

  if (!/^\d+$/.test(normalized)) {
    return DEFAULT_LOG_LINES;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOG_LINES;
  }

  return Math.min(parsed, MAX_LOG_LINES);
}

export function buildComposeCommand(
  action: ServerAction,
  lines?: string
): ComposeCommand {
  switch (action) {
    case "start":
      return {
        command: "docker",
        args: ["compose", "up", "-d", ...DST_SERVICES]
      };
    case "stop":
      return {
        command: "docker",
        args: ["compose", "stop", ...DST_SERVICES]
      };
    case "restart":
      return {
        command: "docker",
        args: ["compose", "restart", ...DST_SERVICES]
      };
    case "status":
      return {
        command: "docker",
        args: ["compose", "ps", "-a", "--format", "json"]
      };
    case "logs":
      return {
        command: "docker",
        args: [
          "compose",
          "logs",
          "--tail",
          String(sanitizeLogLines(lines)),
          ...DST_SERVICES
        ]
      };
  }
}

export function runCompose(
  action: ServerAction,
  cwd: string,
  lines?: string
): Promise<ComposeRunResult> {
  const { command, args } = buildComposeCommand(action, lines);

  return new Promise((resolve, reject) => {
    let composeCwd: string;

    try {
      composeCwd = resolveComposeCwd(action, cwd);
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(command, args, {
      cwd: composeCwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(`docker compose ${action} failed: ${message}`));
    });
  });
}
