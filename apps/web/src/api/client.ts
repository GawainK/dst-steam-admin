export interface ContainerStatus {
  name: "dst-master" | "dst-caves";
  state: string;
  status: string;
  ports: string[];
}

export interface ServerStatus {
  overall: "running" | "stopped" | "partial";
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
    throw new Error(body || `Request failed: ${response.status}`);
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
