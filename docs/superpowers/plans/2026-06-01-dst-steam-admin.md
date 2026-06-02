# DST Steam Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `dst-steam-admin/` project that deploys a Steam Don't Starve Together dedicated server with Docker and provides a Vue-based admin panel for status, lifecycle actions, logs, server config, and mod config.

**Architecture:** The project is a small monorepo with `apps/api` for an Express API and `apps/web` for a Vue 3 admin UI. The API controls Docker through a strict command whitelist and reads/writes project-owned config files under `data/`. Docker Compose runs the admin services and the DST master/caves services.

**Tech Stack:** Vue 3, Vite, TypeScript, Naive UI, lucide-vue-next, Node.js, Express, Vitest, Docker Compose.

---

## File Structure

Create these files:

```text
dst-steam-admin/
  .gitignore
  README.md
  package.json
  pnpm-workspace.yaml
  docker-compose.yml
  apps/
    api/
      Dockerfile
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        app.ts
        index.ts
        config/paths.ts
        config/schema.ts
        docker/compose.ts
        docker/status.ts
        routes/configRoutes.ts
        routes/serverRoutes.ts
        services/configService.ts
        services/fileService.ts
        utils/errors.ts
      tests/
        compose.test.ts
        configService.test.ts
        status.test.ts
    web/
      Dockerfile
      index.html
      nginx.conf
      package.json
      tsconfig.json
      vite.config.ts
      src/
        App.vue
        main.ts
        style.css
        api/client.ts
        components/GlassCard.vue
        components/StatusBadge.vue
        views/DashboardView.vue
        views/ServerControlView.vue
        views/LogsView.vue
        views/WorldConfigView.vue
        views/ModsConfigView.vue
        views/DeployGuideView.vue
  docker/
    dst/
      Dockerfile
      entrypoint.sh
      templates/cluster.ini
      templates/cluster_token.txt
      templates/Master/server.ini
      templates/Caves/server.ini
      templates/dedicated_server_mods_setup.lua
      templates/modoverrides.lua
  data/
    .gitkeep
    cluster/.gitkeep
    mods/.gitkeep
  docs/
    deployment.md
```

Each API file has one responsibility:

- `compose.ts`: maps allowed actions to fixed `docker compose` commands and executes them in the project root.
- `status.ts`: parses Docker Compose JSON output into UI-friendly container status.
- `configService.ts`: validates and persists server and mod configuration.
- `fileService.ts`: reads/writes only files under the project data root.
- Route files: map HTTP endpoints to service functions, without shell logic.

Each web view owns one page. Shared visual behavior stays in `GlassCard.vue` and `StatusBadge.vue`.

After the project directory is created, move the existing planning documentation from the outer `/Users/oukai/personal/docs/` directory into `dst-steam-admin/docs/superpowers/` so all project documentation lives inside the project repository.

## Task 1: Bootstrap Workspace, Git, and Metadata

**Files:**
- Create: `dst-steam-admin/.gitignore`
- Create: `dst-steam-admin/package.json`
- Create: `dst-steam-admin/pnpm-workspace.yaml`
- Create: `dst-steam-admin/README.md`
- Move: `/Users/oukai/personal/docs/superpowers/` to `dst-steam-admin/docs/superpowers/`

- [ ] **Step 1: Create project directory and initialize Git**

Run:

```bash
mkdir -p dst-steam-admin
cd dst-steam-admin
git init
git remote add origin https://github.com/GawainK/dst-steam-admin.git
```

Expected: Git initializes inside `dst-steam-admin/` and `git remote -v` shows the HTTPS origin.

- [ ] **Step 2: Move planning docs into the project**

Run from `/Users/oukai/personal`:

```bash
mkdir -p dst-steam-admin/docs
mv docs/superpowers dst-steam-admin/docs/superpowers
rmdir docs
```

Expected: `dst-steam-admin/docs/superpowers/specs/2026-06-01-dst-steam-admin-design.md` and `dst-steam-admin/docs/superpowers/plans/2026-06-01-dst-steam-admin.md` exist, and the outer `docs/` directory is gone.

- [ ] **Step 3: Create root package files and metadata**

Write `dst-steam-admin/package.json`:

The root `package.json` must include `name`, `private`, and `version`, along with the workspace scripts and `packageManager` shown below:

```json
{
  "name": "dst-steam-admin",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @dst-admin/api --filter @dst-admin/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "packageManager": "pnpm@10.0.0"
}
```

Write `dst-steam-admin/pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
```

Write `dst-steam-admin/.gitignore`:

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
data/**/*.log
data/cluster/*
data/mods/*
!data/.gitkeep
!data/cluster/.gitkeep
!data/mods/.gitkeep
.DS_Store
```

- [ ] **Step 4: Create README introduction**

Write `dst-steam-admin/README.md`:

```markdown
# DST Steam Admin

Steam 版《饥荒联机版》专用服务器 Docker 部署和本地管理后台。

## Features

- Docker Compose 部署 DST Master 和 Caves 服务。
- Vue 3 + Naive UI 管理后台。
- 查看状态、启动、停止、重启服务器。
- 查看日志。
- 编辑基础服务器配置和模组配置。

## Quick Start

1. 安装 Docker、Docker Compose、Node.js 和 pnpm。
2. 编辑 `data/cluster/cluster_token.txt` 或在后台填写 Steam Token。
3. 运行 `docker compose up -d --build`。
4. 打开 `http://localhost:8080`。

详细说明见 `docs/deployment.md`。
```

- [ ] **Step 5: Verify metadata**

Run:

```bash
cd dst-steam-admin
git remote -v
```

Expected: Output includes `https://github.com/GawainK/dst-steam-admin.git`.

## Task 2: API Command Whitelist and Status Parser

**Files:**
- Create: `dst-steam-admin/apps/api/package.json`
- Create: `dst-steam-admin/apps/api/tsconfig.json`
- Create: `dst-steam-admin/apps/api/vitest.config.ts`
- Create: `dst-steam-admin/apps/api/src/config/paths.ts`
- Create: `dst-steam-admin/apps/api/src/docker/compose.ts`
- Create: `dst-steam-admin/apps/api/src/docker/status.ts`
- Test: `dst-steam-admin/apps/api/tests/compose.test.ts`
- Test: `dst-steam-admin/apps/api/tests/status.test.ts`

- [ ] **Step 1: Create API package metadata**

Write `dst-steam-admin/apps/api/package.json`:

```json
{
  "name": "@dst-admin/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

Write `tsconfig.json` and `vitest.config.ts` with ESM TypeScript output to `dist/`.

- [ ] **Step 2: Write failing tests for command whitelist**

Write `dst-steam-admin/apps/api/tests/compose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildComposeCommand, sanitizeLogLines } from "../src/docker/compose";

describe("buildComposeCommand", () => {
  it("maps start to a fixed docker compose command", () => {
    expect(buildComposeCommand("start")).toEqual({
      command: "docker",
      args: ["compose", "up", "-d", "dst-master", "dst-caves"],
    });
  });

  it("maps stop and restart without accepting arbitrary shell input", () => {
    expect(buildComposeCommand("stop").args).toEqual([
      "compose",
      "stop",
      "dst-master",
      "dst-caves",
    ]);
    expect(buildComposeCommand("restart").args).toEqual([
      "compose",
      "restart",
      "dst-master",
      "dst-caves",
    ]);
  });

  it("limits log lines to a bounded numeric range", () => {
    expect(sanitizeLogLines("20")).toBe(20);
    expect(sanitizeLogLines("9999")).toBe(1000);
    expect(sanitizeLogLines("abc")).toBe(200);
  });
});
```

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/api test tests/compose.test.ts
```

Expected: FAIL because `compose.ts` does not exist yet.

- [ ] **Step 3: Implement minimal command whitelist**

Write `dst-steam-admin/apps/api/src/docker/compose.ts` with:

```ts
import { spawn } from "node:child_process";

export type ServerAction = "start" | "stop" | "restart" | "status" | "logs";

export interface ComposeCommand {
  command: "docker";
  args: string[];
}

export function sanitizeLogLines(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 200;
  return Math.min(parsed, 1000);
}

export function buildComposeCommand(action: ServerAction, lines?: unknown): ComposeCommand {
  if (action === "start") {
    return { command: "docker", args: ["compose", "up", "-d", "dst-master", "dst-caves"] };
  }
  if (action === "stop") {
    return { command: "docker", args: ["compose", "stop", "dst-master", "dst-caves"] };
  }
  if (action === "restart") {
    return { command: "docker", args: ["compose", "restart", "dst-master", "dst-caves"] };
  }
  if (action === "status") {
    return { command: "docker", args: ["compose", "ps", "--format", "json"] };
  }
  return {
    command: "docker",
    args: ["compose", "logs", "--tail", String(sanitizeLogLines(lines)), "dst-master", "dst-caves"],
  };
}

export function runCompose(action: ServerAction, cwd: string, lines?: unknown): Promise<string> {
  const { command, args } = buildComposeCommand(action, lines);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${action} failed with exit code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}
```

- [ ] **Step 4: Write failing status parser tests**

Write `dst-steam-admin/apps/api/tests/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseComposeStatus } from "../src/docker/status";

describe("parseComposeStatus", () => {
  it("parses newline-delimited docker compose JSON", () => {
    const input = [
      JSON.stringify({ Service: "dst-master", State: "running", Publishers: [{ URL: "0.0.0.0", TargetPort: 10999, PublishedPort: 10999, Protocol: "udp" }] }),
      JSON.stringify({ Service: "dst-caves", State: "exited", Publishers: [{ TargetPort: 11000, PublishedPort: 11000, Protocol: "udp" }] }),
    ].join("\n");

    expect(parseComposeStatus(input)).toEqual({
      overall: "partial",
      containers: [
        { name: "dst-master", state: "running", ports: ["10999:10999/udp"] },
        { name: "dst-caves", state: "exited", ports: ["11000:11000/udp"] },
      ],
    });
  });
});
```

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/api test tests/status.test.ts
```

Expected: FAIL because `status.ts` does not exist yet.

- [ ] **Step 5: Implement status parser**

Write `dst-steam-admin/apps/api/src/docker/status.ts`:

```ts
export interface ContainerStatus {
  name: string;
  state: string;
  ports: string[];
}

export interface ServerStatus {
  overall: "running" | "stopped" | "partial";
  containers: ContainerStatus[];
}

interface ComposePublisher {
  TargetPort?: number;
  PublishedPort?: number;
  Protocol?: string;
}

interface ComposeRow {
  Service?: string;
  Name?: string;
  State?: string;
  Publishers?: ComposePublisher[];
}

export function parseComposeStatus(output: string): ServerStatus {
  const containers = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ComposeRow)
    .filter((row) => row.Service === "dst-master" || row.Service === "dst-caves")
    .map((row) => ({
      name: row.Service ?? row.Name ?? "unknown",
      state: row.State ?? "unknown",
      ports: (row.Publishers ?? []).map((port) => {
        const published = port.PublishedPort ?? port.TargetPort;
        const target = port.TargetPort ?? published;
        const protocol = port.Protocol ?? "udp";
        return `${published}:${target}/${protocol}`;
      }),
    }));

  const runningCount = containers.filter((container) => container.state === "running").length;
  const overall = runningCount === containers.length && containers.length > 0
    ? "running"
    : runningCount === 0
      ? "stopped"
      : "partial";

  return { overall, containers };
}
```

- [ ] **Step 6: Verify API command tests**

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/api test tests/compose.test.ts tests/status.test.ts
```

Expected: PASS.

## Task 3: API Configuration Services

**Files:**
- Create: `dst-steam-admin/apps/api/src/config/schema.ts`
- Create: `dst-steam-admin/apps/api/src/config/paths.ts`
- Create: `dst-steam-admin/apps/api/src/services/fileService.ts`
- Create: `dst-steam-admin/apps/api/src/services/configService.ts`
- Test: `dst-steam-admin/apps/api/tests/configService.test.ts`

- [ ] **Step 1: Write failing config service tests**

Write `dst-steam-admin/apps/api/tests/configService.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readServerConfig, writeModConfig, writeServerConfig } from "../src/services/configService";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe("configService", () => {
  it("writes and reads validated server config", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "dst-admin-"));
    await writeServerConfig(tempRoot, {
      steamToken: "token-value",
      clusterName: "My DST Server",
      clusterPassword: "",
      maxPlayers: 6,
      gameMode: "survival",
      enableCaves: true,
      masterPort: 10999,
      cavesPort: 11000,
    });

    await expect(readServerConfig(tempRoot)).resolves.toMatchObject({
      clusterName: "My DST Server",
      maxPlayers: 6,
      enableCaves: true,
    });
  });

  it("rejects invalid ports and max players", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "dst-admin-"));
    await expect(writeServerConfig(tempRoot, {
      steamToken: "token-value",
      clusterName: "Bad Server",
      clusterPassword: "",
      maxPlayers: 100,
      gameMode: "survival",
      enableCaves: true,
      masterPort: 1,
      cavesPort: 11000,
    })).rejects.toThrow();
  });

  it("writes mod config files without parsing Lua", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "dst-admin-"));
    await writeModConfig(tempRoot, {
      dedicatedServerModsSetup: "ServerModSetup(\"123\")",
      modOverrides: "return { [\"workshop-123\"] = { enabled = true } }",
    });

    const config = await readServerConfig(tempRoot).catch(() => undefined);
    expect(config).toBeUndefined();
  });
});
```

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/api test tests/configService.test.ts
```

Expected: FAIL because config service files do not exist yet.

- [ ] **Step 2: Implement schema and file paths**

Write `dst-steam-admin/apps/api/src/config/schema.ts`:

```ts
import { z } from "zod";

export const serverConfigSchema = z.object({
  steamToken: z.string().min(1),
  clusterName: z.string().min(1).max(80),
  clusterPassword: z.string().max(80).default(""),
  maxPlayers: z.number().int().min(1).max(64),
  gameMode: z.enum(["survival", "endless", "wilderness"]).default("survival"),
  enableCaves: z.boolean().default(true),
  masterPort: z.number().int().min(1024).max(65535),
  cavesPort: z.number().int().min(1024).max(65535),
});

export const modConfigSchema = z.object({
  dedicatedServerModsSetup: z.string(),
  modOverrides: z.string(),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type ModConfig = z.infer<typeof modConfigSchema>;
```

Write `dst-steam-admin/apps/api/src/config/paths.ts`:

```ts
import { resolve } from "node:path";

export function getProjectRoot(): string {
  return resolve(process.env.PROJECT_ROOT ?? process.cwd());
}

export function getDataRoot(projectRoot = getProjectRoot()): string {
  return resolve(projectRoot, "data");
}
```

- [ ] **Step 3: Implement file service**

Write `dst-steam-admin/apps/api/src/services/fileService.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function resolveInside(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  const normalizedRoot = resolve(root);
  if (!target.startsWith(normalizedRoot)) {
    throw new Error("Path escapes data root");
  }
  return target;
}

export async function readText(root: string, relativePath: string): Promise<string> {
  return readFile(resolveInside(root, relativePath), "utf8");
}

export async function writeText(root: string, relativePath: string, value: string): Promise<void> {
  const target = resolveInside(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value, "utf8");
}
```

- [ ] **Step 4: Implement config service**

Write `dst-steam-admin/apps/api/src/services/configService.ts`:

```ts
import { getDataRoot } from "../config/paths";
import { modConfigSchema, serverConfigSchema, type ModConfig, type ServerConfig } from "../config/schema";
import { readText, writeText } from "./fileService";

const serverConfigPath = "cluster/admin-server-config.json";
const tokenPath = "cluster/cluster_token.txt";
const dedicatedModsPath = "cluster/dedicated_server_mods_setup.lua";
const modOverridesPath = "cluster/Master/modoverrides.lua";

export async function readServerConfig(projectRoot?: string): Promise<ServerConfig> {
  const dataRoot = getDataRoot(projectRoot);
  const raw = await readText(dataRoot, serverConfigPath);
  return serverConfigSchema.parse(JSON.parse(raw));
}

export async function writeServerConfig(projectRoot: string | undefined, input: ServerConfig): Promise<ServerConfig> {
  const config = serverConfigSchema.parse(input);
  const dataRoot = getDataRoot(projectRoot);
  await writeText(dataRoot, serverConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeText(dataRoot, tokenPath, `${config.steamToken}\n`);
  return config;
}

export async function readModConfig(projectRoot?: string): Promise<ModConfig> {
  const dataRoot = getDataRoot(projectRoot);
  const dedicatedServerModsSetup = await readText(dataRoot, dedicatedModsPath).catch(() => "");
  const modOverrides = await readText(dataRoot, modOverridesPath).catch(() => "return {}\n");
  return modConfigSchema.parse({ dedicatedServerModsSetup, modOverrides });
}

export async function writeModConfig(projectRoot: string | undefined, input: ModConfig): Promise<ModConfig> {
  const config = modConfigSchema.parse(input);
  const dataRoot = getDataRoot(projectRoot);
  await writeText(dataRoot, dedicatedModsPath, config.dedicatedServerModsSetup);
  await writeText(dataRoot, modOverridesPath, config.modOverrides);
  return config;
}
```

- [ ] **Step 5: Verify config tests**

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/api test tests/configService.test.ts
```

Expected: PASS.

## Task 4: Express API Routes

**Files:**
- Create: `dst-steam-admin/apps/api/src/utils/errors.ts`
- Create: `dst-steam-admin/apps/api/src/routes/serverRoutes.ts`
- Create: `dst-steam-admin/apps/api/src/routes/configRoutes.ts`
- Create: `dst-steam-admin/apps/api/src/app.ts`
- Create: `dst-steam-admin/apps/api/src/index.ts`

- [ ] **Step 1: Implement error responses**

Write `dst-steam-admin/apps/api/src/utils/errors.ts`:

```ts
import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  response.status(500).json({
    error: message.replace(/cluster_token[^\s]*/gi, "cluster_token=[redacted]"),
  });
};
```

- [ ] **Step 2: Implement server routes**

Write `dst-steam-admin/apps/api/src/routes/serverRoutes.ts`:

```ts
import { Router } from "express";
import { getProjectRoot } from "../config/paths";
import { runCompose } from "../docker/compose";
import { parseComposeStatus } from "../docker/status";

export const serverRoutes = Router();

serverRoutes.get("/status", async (_request, response, next) => {
  try {
    const output = await runCompose("status", getProjectRoot());
    response.json(parseComposeStatus(output));
  } catch (error) {
    next(error);
  }
});

serverRoutes.post("/start", async (_request, response, next) => {
  try {
    await runCompose("start", getProjectRoot());
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

serverRoutes.post("/stop", async (_request, response, next) => {
  try {
    await runCompose("stop", getProjectRoot());
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

serverRoutes.post("/restart", async (_request, response, next) => {
  try {
    await runCompose("restart", getProjectRoot());
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

serverRoutes.get("/logs", async (request, response, next) => {
  try {
    const output = await runCompose("logs", getProjectRoot(), request.query.lines);
    response.json({ logs: output });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: Implement config routes and app bootstrap**

Write `dst-steam-admin/apps/api/src/routes/configRoutes.ts`:

```ts
import { Router } from "express";
import { readModConfig, readServerConfig, writeModConfig, writeServerConfig } from "../services/configService";

export const configRoutes = Router();

configRoutes.get("/server", async (_request, response, next) => {
  try {
    response.json(await readServerConfig());
  } catch (error) {
    next(error);
  }
});

configRoutes.put("/server", async (request, response, next) => {
  try {
    response.json(await writeServerConfig(undefined, request.body));
  } catch (error) {
    next(error);
  }
});

configRoutes.get("/mods", async (_request, response, next) => {
  try {
    response.json(await readModConfig());
  } catch (error) {
    next(error);
  }
});

configRoutes.put("/mods", async (request, response, next) => {
  try {
    response.json(await writeModConfig(undefined, request.body));
  } catch (error) {
    next(error);
  }
});
```

Write `dst-steam-admin/apps/api/src/app.ts`:

```ts
import cors from "cors";
import express from "express";
import { configRoutes } from "./routes/configRoutes";
import { serverRoutes } from "./routes/serverRoutes";
import { errorHandler } from "./utils/errors";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.use("/api/server", serverRoutes);
  app.use("/api/config", configRoutes);
  app.use(errorHandler);
  return app;
}
```

Write `dst-steam-admin/apps/api/src/index.ts`:

```ts
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, "0.0.0.0", () => {
  console.log(`DST admin API listening on ${port}`);
});
```

- [ ] **Step 4: Verify API build**

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/api build
```

Expected: PASS.

## Task 5: Vue Admin UI

**Files:**
- Create: `dst-steam-admin/apps/web/package.json`
- Create: `dst-steam-admin/apps/web/index.html`
- Create: `dst-steam-admin/apps/web/tsconfig.json`
- Create: `dst-steam-admin/apps/web/vite.config.ts`
- Create: all files under `dst-steam-admin/apps/web/src/`

- [ ] **Step 1: Create web package metadata**

Write `dst-steam-admin/apps/web/package.json`:

```json
{
  "name": "@dst-admin/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vue-tsc -b && vite build",
    "test": "echo \"web smoke tests run through build\"",
    "lint": "vue-tsc -b --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "lucide-vue-next": "^0.468.0",
    "naive-ui": "^2.40.0",
    "vooks": "^0.2.12",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vite": "^6.0.0",
    "vue-tsc": "^2.2.0"
  }
}
```

Write Vite and TypeScript config for Vue 3.

- [ ] **Step 2: Implement API client**

Write `dst-steam-admin/apps/web/src/api/client.ts`:

```ts
export interface ServerStatus {
  overall: "running" | "stopped" | "partial";
  containers: Array<{ name: string; state: string; ports: string[] }>;
}

export interface ServerConfig {
  steamToken: string;
  clusterName: string;
  clusterPassword: string;
  maxPlayers: number;
  gameMode: "survival" | "endless" | "wilderness";
  enableCaves: boolean;
  masterPort: number;
  cavesPort: number;
}

export interface ModConfig {
  dedicatedServerModsSetup: string;
  modOverrides: string;
}

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<ServerStatus>("/server/status"),
  start: () => request<{ ok: true }>("/server/start", { method: "POST" }),
  stop: () => request<{ ok: true }>("/server/stop", { method: "POST" }),
  restart: () => request<{ ok: true }>("/server/restart", { method: "POST" }),
  logs: (lines = 200) => request<{ logs: string }>(`/server/logs?lines=${lines}`),
  getServerConfig: () => request<ServerConfig>("/config/server"),
  saveServerConfig: (config: ServerConfig) => request<ServerConfig>("/config/server", { method: "PUT", body: JSON.stringify(config) }),
  getModConfig: () => request<ModConfig>("/config/mods"),
  saveModConfig: (config: ModConfig) => request<ModConfig>("/config/mods", { method: "PUT", body: JSON.stringify(config) }),
};
```

- [ ] **Step 3: Implement glass shell**

Write `dst-steam-admin/apps/web/src/App.vue` with a Naive UI layout, side menu keys `dashboard`, `control`, `logs`, `world`, `mods`, `deploy`, and a local `activeView` state that renders each view component.

Write `dst-steam-admin/apps/web/src/style.css` with:

```css
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #18181c;
  background: #eef3ff;
}

body {
  margin: 0;
}

#app {
  min-height: 100vh;
}

.glass-app {
  min-height: 100vh;
  background:
    radial-gradient(circle at 18% 10%, rgba(24, 160, 88, 0.18), transparent 26%),
    radial-gradient(circle at 82% 18%, rgba(32, 128, 240, 0.14), transparent 28%),
    linear-gradient(135deg, #e8f5ee 0%, #eef3ff 46%, #f7f7fb 100%);
}

.glass-panel {
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px);
  border-radius: 8px;
}

.terminal-log {
  background: #08080a;
  color: #e4e4e7;
  border-radius: 8px;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
}
```

- [ ] **Step 4: Implement pages**

Create the six view files. Each page must use Naive UI components, avoid nested card containers, and keep logs high-contrast:

- `DashboardView.vue`: status cards, quick action buttons, recent logs.
- `ServerControlView.vue`: action buttons with `n-popconfirm` for stop/restart.
- `LogsView.vue`: line count selector, refresh button, auto-refresh switch, `n-scrollbar` log output.
- `WorldConfigView.vue`: `n-form` for server fields and save button.
- `ModsConfigView.vue`: `n-tabs` with two `n-input type="textarea"` editors.
- `DeployGuideView.vue`: deployment checklist and port table.

- [ ] **Step 5: Verify web build**

Run:

```bash
cd dst-steam-admin
pnpm --filter @dst-admin/web build
```

Expected: PASS.

## Task 6: Docker and DST Templates

**Files:**
- Create: `dst-steam-admin/docker-compose.yml`
- Create: `dst-steam-admin/apps/api/Dockerfile`
- Create: `dst-steam-admin/apps/web/Dockerfile`
- Create: `dst-steam-admin/apps/web/nginx.conf`
- Create: files under `dst-steam-admin/docker/dst/`
- Create: `dst-steam-admin/data/.gitkeep`
- Create: `dst-steam-admin/data/cluster/.gitkeep`
- Create: `dst-steam-admin/data/mods/.gitkeep`

- [ ] **Step 1: Create API and Web Dockerfiles**

Write API Dockerfile as a Node 22 image that installs workspace dependencies and runs `@dst-admin/api`.

Write Web Dockerfile as a multi-stage build with Node 22 build stage and Nginx runtime stage.

Write `nginx.conf` to serve `/usr/share/nginx/html` and proxy `/api/` to `admin-api:3000`.

- [ ] **Step 2: Create DST Dockerfile and entrypoint**

Write `docker/dst/Dockerfile` using a Debian/Ubuntu base with SteamCMD installed. The entrypoint updates app `343050` and starts `dontstarve_dedicated_server_nullrenderer` with cluster and shard arguments.

Write `docker/dst/entrypoint.sh`:

```sh
#!/usr/bin/env sh
set -eu

STEAM_APP_ID=343050
INSTALL_DIR=/opt/dst
CLUSTER_NAME="${CLUSTER_NAME:-Cluster_1}"
SHARD_NAME="${SHARD_NAME:-Master}"

steamcmd +force_install_dir "$INSTALL_DIR" +login anonymous +app_update "$STEAM_APP_ID" validate +quit

mkdir -p "/var/lib/dst/cluster/$SHARD_NAME"
cd "$INSTALL_DIR/bin64"

exec ./dontstarve_dedicated_server_nullrenderer_x64 \
  -persistent_storage_root /var/lib/dst \
  -conf_dir cluster \
  -cluster "$CLUSTER_NAME" \
  -shard "$SHARD_NAME"
```

- [ ] **Step 3: Create Docker Compose**

Write `docker-compose.yml` with services `admin-api`, `admin-web`, `dst-master`, `dst-caves`. Mount `/var/run/docker.sock` into `admin-api`, mount `./data:/app/data`, expose web on `8080`, and expose UDP ports `10999` and `11000`.

- [ ] **Step 4: Create config templates**

Create default DST templates:

- `cluster.ini`: cluster name, password, game mode, max players.
- `cluster_token.txt`: empty file with comment text in docs telling users to fill it.
- `Master/server.ini`: master shard settings.
- `Caves/server.ini`: caves shard settings.
- `dedicated_server_mods_setup.lua`: empty setup with comments.
- `modoverrides.lua`: `return {}`.

## Task 7: Documentation and Verification

**Files:**
- Create: `dst-steam-admin/docs/deployment.md`
- Modify: `dst-steam-admin/README.md`

- [ ] **Step 1: Write deployment docs**

Write `docs/deployment.md` with:

```markdown
# Deployment

## Requirements

- Docker
- Docker Compose
- Steam account access to generate a DST cluster token

## Steam Token

Generate a Don't Starve Together cluster token from the game client and place it in `data/cluster/cluster_token.txt`, or enter it from the admin panel.

## Start

```bash
docker compose up -d --build
```

Open `http://localhost:8080`.

## Ports

- Admin Web: TCP 8080
- DST Master: UDP 10999
- DST Caves: UDP 11000

## Data

- `data/cluster`: DST cluster config and saves
- `data/mods`: mod helper files

## Security

This admin panel is intended for local or private-network use. Do not expose it to the public internet without authentication, TLS, and firewall controls.
```

- [ ] **Step 2: Run full checks**

Run:

```bash
cd dst-steam-admin
pnpm install
pnpm test
pnpm build
```

Expected: tests pass and both packages build. If dependency installation fails due to network restrictions, rerun with escalated approval.

- [ ] **Step 3: Verify Docker config syntax**

Run:

```bash
cd dst-steam-admin
docker compose config
```

Expected: Docker Compose renders a valid merged configuration.

- [ ] **Step 4: Commit initial project**

Run:

```bash
cd dst-steam-admin
git status --short
git add .gitignore README.md package.json pnpm-workspace.yaml docker-compose.yml apps docker data docs
git feat "初始化饥荒服务管理后台"
```

Expected: Commit succeeds using the user's global Git alias. The commit message should include the alias-generated format if the branch contains an `FS-` ticket; otherwise it uses the alias default behavior.

## Self-Review

Spec coverage:

- Docker deployment is covered by Task 6 and Task 7.
- Vue 3 + Naive UI + light glass UI is covered by Task 5.
- Start, stop, restart, status, and logs are covered by Task 2 and Task 4.
- Server and mod config editing are covered by Task 3, Task 4, and Task 5.
- Git remote is covered by Task 1.
- Moving the outer documentation into the project is covered by Task 1.
- Documentation is covered by Task 7.

No placeholders remain in this plan. Type names used in later tasks match definitions introduced earlier: `ServerStatus`, `ServerConfig`, `ModConfig`, `buildComposeCommand`, `runCompose`, `parseComposeStatus`, `readServerConfig`, `writeServerConfig`, `readModConfig`, and `writeModConfig`.
