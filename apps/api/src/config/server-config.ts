import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { ZodError, z } from "zod";

import { serverConfigSchema, type ServerConfigInput } from "./schema.js";

const DEFAULT_SERVER_CONFIG = {
  steamToken: "",
  clusterName: "DST Steam Admin",
  clusterPassword: "",
  maxPlayers: 6,
  gameMode: "survival" as const,
  enableCaves: true,
  masterPort: 10999,
  cavesPort: 11000
};

function getServerConfigPath(projectRoot: string) {
  return resolve(projectRoot, "data/cluster/admin/server-config.json");
}

function maskSteamToken(steamToken: string) {
  return steamToken.length <= 3 ? "***" : `${steamToken.slice(0, 3)}***`;
}

async function readStoredServerConfig(projectRoot: string) {
  const configPath = getServerConfigPath(projectRoot);
  const raw = await fs.readFile(configPath, "utf8");
  return serverConfigSchema.parse(JSON.parse(raw));
}

export async function writeServerConfig(
  projectRoot: string,
  input: ServerConfigInput
) {
  let normalizedInput = input;

  if (input.steamToken.trim() === "") {
    try {
      const existing = await readStoredServerConfig(projectRoot);
      normalizedInput = {
        ...input,
        steamToken: existing.steamToken
      };
    } catch {
      throw new ZodError([
        {
          code: z.ZodIssueCode.too_small,
          minimum: 1,
          type: "string",
          inclusive: true,
          exact: false,
          message: "String must contain at least 1 character(s)",
          path: ["steamToken"]
        }
      ]);
    }
  }

  const config = serverConfigSchema.parse(normalizedInput);
  const configPath = getServerConfigPath(projectRoot);

  await fs.mkdir(resolve(projectRoot, "data/cluster/admin"), {
    recursive: true
  });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function readServerConfig(projectRoot: string) {
  let parsed: ServerConfigInput;
  let steamTokenMasked = "";

  try {
    parsed = await readStoredServerConfig(projectRoot);
    steamTokenMasked = maskSteamToken(parsed.steamToken);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    parsed = DEFAULT_SERVER_CONFIG;
  }

  return {
    clusterName: parsed.clusterName,
    clusterPassword: parsed.clusterPassword,
    maxPlayers: parsed.maxPlayers,
    gameMode: parsed.gameMode,
    enableCaves: parsed.enableCaves,
    masterPort: parsed.masterPort,
    cavesPort: parsed.cavesPort,
    steamToken: "",
    steamTokenMasked
  };
}
