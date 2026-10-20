import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { ZodError, z } from "zod";

import { serverConfigSchema, type ServerConfigInput } from "./schema.js";

// The initial file is an editable draft until its token is configured.
// Saving still uses serverConfigSchema, which requires a nonempty token.
const storedServerConfigSchema = serverConfigSchema.extend({ steamToken: z.string() });

const DEFAULT_SERVER_CONFIG = {
  steamToken: "",
  clusterName: "DST Steam Admin",
  clusterPassword: "",
  maxPlayers: 6,
  gameMode: "survival" as const,
  enableCaves: true,
  pauseWhenEmpty: true,
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
  return storedServerConfigSchema.parse(JSON.parse(raw));
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

  if (normalizedInput.pauseWhenEmpty === undefined) {
    // Older clients must retain a value explicitly set in the config file.
    let pauseWhenEmpty = true;
    try {
      pauseWhenEmpty = (await readStoredServerConfig(projectRoot)).pauseWhenEmpty;
    } catch {
      // A first save uses the same default as the renderer.
    }
    normalizedInput = { ...normalizedInput, pauseWhenEmpty };
  }

  const config = serverConfigSchema.parse(normalizedInput);
  const configPath = getServerConfigPath(projectRoot);

  await fs.mkdir(resolve(projectRoot, "data/cluster/admin"), {
    recursive: true
  });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function readServerConfig(projectRoot: string) {
  let parsed: z.infer<typeof storedServerConfigSchema>;
  let steamTokenMasked = "";

  try {
    parsed = await readStoredServerConfig(projectRoot);
    steamTokenMasked = parsed.steamToken ? maskSteamToken(parsed.steamToken) : "";
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
    pauseWhenEmpty: parsed.pauseWhenEmpty,
    masterPort: parsed.masterPort,
    cavesPort: parsed.cavesPort,
    steamToken: "",
    steamTokenMasked
  };
}
