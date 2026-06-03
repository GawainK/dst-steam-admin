import { promises as fs } from "node:fs";
import { resolve } from "node:path";

const STEAM_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

interface SteamResponse {
  response?: {
    publishedfiledetails?: { publishedfileid: string; title?: string }[];
  };
}

function cachePath(projectRoot: string): string {
  return resolve(projectRoot, "data/mods/.mod-names.json");
}

async function readCache(projectRoot: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(cachePath(projectRoot), "utf8"));
  } catch {
    return {};
  }
}

async function writeCache(
  projectRoot: string,
  cache: Record<string, string>
): Promise<void> {
  await fs.mkdir(resolve(projectRoot, "data/mods"), { recursive: true });
  await fs.writeFile(cachePath(projectRoot), JSON.stringify(cache, null, 2));
}

async function fetchTitles(
  ids: string[],
  fetchImpl: typeof fetch
): Promise<Record<string, string>> {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));

  const response = await fetchImpl(STEAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`steam ${response.status}`);

  const data = (await response.json()) as SteamResponse;
  const titles: Record<string, string> = {};
  for (const detail of data.response?.publishedfiledetails ?? []) {
    if (detail.title) titles[detail.publishedfileid] = detail.title;
  }
  return titles;
}

export async function resolveModNames(
  projectRoot: string,
  ids: string[],
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, string | null>> {
  const cache = await readCache(projectRoot);
  const missing = ids.filter((id) => !(id in cache));

  if (missing.length > 0) {
    try {
      const titles = await fetchTitles(missing, fetchImpl);
      Object.assign(cache, titles);
      await writeCache(projectRoot, cache);
    } catch {
      // 网络/解析失败：忽略，降级为 null
    }
  }

  const result: Record<string, string | null> = {};
  for (const id of ids) result[id] = cache[id] ?? null;
  return result;
}
