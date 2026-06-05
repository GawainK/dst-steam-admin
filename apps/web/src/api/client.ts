export interface ContainerStatus {
  name: "dst-master" | "dst-caves";
  state: string;
  status: string;
  ports: string[];
}

export interface ServerStatus {
  overall: "running" | "starting" | "stopped" | "partial";
  containers: ContainerStatus[];
}

export interface ServerConfig {
  steamToken: string;
  steamTokenMasked?: string;
  clusterName: string;
  clusterPassword: string;
  maxPlayers: number;
  gameMode: "survival" | "endless" | "wilderness";
  enableCaves: boolean;
  masterPort: number;
  cavesPort: number;
}

export interface ModsConfig {
  setup: string;
  overrides: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    let messageText = body;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed?.error) {
        messageText = parsed.error;
      }
    } catch {
      // 非 JSON 响应：保留原始文本
    }
    throw new Error(messageText || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getServerStatus() {
  return request<ServerStatus>("/api/server/status");
}

export async function startServer() {
  await request("/api/server/start", { method: "POST" });
}

export async function stopServer() {
  await request("/api/server/stop", { method: "POST" });
}

export async function restartServer() {
  await request("/api/server/restart", { method: "POST" });
}

export function getServerLogs(lines = 200) {
  return request<{ content: string }>(`/api/server/logs?lines=${lines}`);
}

export function getServerConfig() {
  return request<ServerConfig>("/api/config/server");
}

export async function saveServerConfig(payload: ServerConfig) {
  await request("/api/config/server", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getModsConfig() {
  return request<ModsConfig>("/api/config/mods");
}

export async function saveModsConfig(payload: ModsConfig) {
  await request("/api/config/mods", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export interface ModListItem {
  id: string;
  name: string | null;
  enabled: boolean;
  inSetup: boolean;
  configRaw: string;
}

export function getModList() {
  return request<{ items: ModListItem[] }>("/api/config/mods/list");
}

export async function addMod(id: string) {
  await request("/api/config/mods", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export async function removeMod(id: string) {
  await request(`/api/config/mods/${id}`, { method: "DELETE" });
}

export async function setModEnabled(id: string, enabled: boolean) {
  await request(`/api/config/mods/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
}

export interface BackupEntry {
  name: string;
  createdAt: string;
  size: number;
}

export function listBackups() {
  return request<{ items: BackupEntry[] }>("/api/backups");
}

export function createBackup(label?: string) {
  return request<BackupEntry>("/api/backups", {
    method: "POST",
    body: JSON.stringify(label ? { label } : {})
  });
}

export async function restoreBackup(name: string) {
  await request(`/api/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
}

export async function deleteBackup(name: string) {
  await request(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function backupDownloadUrl(name: string) {
  return `/api/backups/${encodeURIComponent(name)}/download`;
}
