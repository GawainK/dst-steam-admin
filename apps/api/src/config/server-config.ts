import { promises as fs } from "node:fs";
import { resolve } from "node:path";

import { serverConfigSchema, type ServerConfigInput } from "./schema.js";

function getServerConfigPath(projectRoot: string) {
  return resolve(projectRoot, "data/cluster/admin/server-config.json");
}

function maskSteamToken(steamToken: string) {
  return steamToken.length <= 3 ? "***" : `${steamToken.slice(0, 3)}***`;
}

export async function writeServerConfig(
  projectRoot: string,
  input: ServerConfigInput
) {
  const config = serverConfigSchema.parse(input);
  const configPath = getServerConfigPath(projectRoot);

  await fs.mkdir(resolve(projectRoot, "data/cluster/admin"), {
    recursive: true
  });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function readServerConfig(projectRoot: string) {
  const configPath = getServerConfigPath(projectRoot);
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = serverConfigSchema.parse(JSON.parse(raw));

  return {
    ...parsed,
    steamTokenMasked: maskSteamToken(parsed.steamToken)
  };
}
