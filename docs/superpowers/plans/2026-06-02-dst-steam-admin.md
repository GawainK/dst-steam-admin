# DST Steam Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable first version of the DST Steam Admin project with Docker-backed server control, config editing, logs, a Vue admin UI, and deployment docs.

**Architecture:** Keep the API as the only component allowed to touch Docker and project data files. Add focused file services for server config and Lua mod files, expose a small REST surface, then build a single-page Vue dashboard that consumes those APIs. Finish with Docker Compose, DST runtime assets, and docs so local development and container deployment match closely.

**Tech Stack:** Node.js, Express, TypeScript, Vitest, Vue 3, Vite, TypeScript, Naive UI, lucide-vue-next, Docker Compose

---

## File Structure

- `apps/api/src/index.ts`: Express bootstrap, middleware, route registration, shared error handling.
- `apps/api/src/docker/compose.ts`: Docker Compose command mapping and process execution.
- `apps/api/src/docker/status.ts`: Compose status parsing.
- `apps/api/src/server/service.ts`: High-level server control and log read service.
- `apps/api/src/server/routes.ts`: `/api/server/*` handlers.
- `apps/api/src/config/paths.ts`: Project, data, cluster, and mods path helpers.
- `apps/api/src/config/schema.ts`: Zod schemas and types for server config payloads.
- `apps/api/src/config/server-config.ts`: Read/write the structured server config file and sync target DST files.
- `apps/api/src/config/mod-files.ts`: Read/write raw Lua mod config files.
- `apps/api/src/config/routes.ts`: `/api/config/*` handlers.
- `apps/api/tests/*.test.ts`: Vitest coverage for route behavior, validation, config IO, and redaction.
- `apps/web/*`: Vue app scaffold, router-less dashboard shell, API client, pages, and theme styles.
- `docker/dst/*`: Dockerfile, bootstrap scripts, and config templates for DST containers.
- `data/cluster/*`: Example cluster config and mounted runtime files.
- `data/mods/*`: Example Lua mod files.
- `docker-compose.yml`: Full local deployment stack.
- `README.md` and `docs/deployment.md`: Setup, development, and deployment instructions.

### Task 1: Finish API server-control endpoints

**Files:**
- Create: `apps/api/src/server/service.ts`
- Create: `apps/api/src/server/routes.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/server-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const runComposeMock = vi.fn();
const parseComposeStatusMock = vi.fn();

vi.mock("../src/docker/compose.js", () => ({
  runCompose: runComposeMock
}));

vi.mock("../src/docker/status.js", () => ({
  parseComposeStatus: parseComposeStatusMock
}));

import { createServerRouter } from "../src/server/routes.js";

describe("server routes", () => {
  it("returns parsed status from docker compose output", async () => {
    runComposeMock.mockResolvedValue({ stdout: "[]", stderr: "" });
    parseComposeStatusMock.mockReturnValue({ overall: "stopped", containers: [] });

    const app = express();
    app.use("/api/server", createServerRouter(process.cwd()));

    const response = await request(app).get("/api/server/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ overall: "stopped", containers: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/server-routes.test.ts`
Expected: FAIL because `createServerRouter` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import { Router } from "express";

import { runCompose } from "../docker/compose.js";
import { parseComposeStatus } from "../docker/status.js";

export function createServerRouter(projectRoot: string): Router {
  const router = Router();

  router.get("/status", async (_request, response, next) => {
    try {
      const result = await runCompose("status", projectRoot);
      response.json(parseComposeStatus(result.stdout));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/server-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Expand the test for control and logs routes**

```ts
it.each(["start", "stop", "restart"] as const)(
  "runs %s through docker compose",
  async (action) => {
    runComposeMock.mockResolvedValue({ stdout: "ok", stderr: "" });

    const app = express();
    app.use("/api/server", createServerRouter(process.cwd()));

    const response = await request(app).post(`/api/server/${action}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(runComposeMock).toHaveBeenCalledWith(action, process.cwd(), undefined);
  }
);

it("limits log line queries before calling docker compose", async () => {
  runComposeMock.mockResolvedValue({ stdout: "log line", stderr: "" });

  const app = express();
  app.use("/api/server", createServerRouter(process.cwd()));

  const response = await request(app).get("/api/server/logs?lines=5000");

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ content: "log line" });
  expect(runComposeMock).toHaveBeenCalledWith("logs", process.cwd(), "5000");
});
```

- [ ] **Step 6: Run the expanded test to verify it fails**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/server-routes.test.ts`
Expected: FAIL on missing `POST` routes and `/logs`.

- [ ] **Step 7: Write minimal implementation for the remaining routes and shared API error handling**

```ts
router.post("/:action(start|stop|restart)", async (request, response, next) => {
  try {
    await runCompose(request.params.action, projectRoot);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/logs", async (request, response, next) => {
  try {
    const result = await runCompose("logs", projectRoot, String(request.query.lines ?? ""));
    response.json({ content: result.stdout });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 8: Run API tests**

Run: `pnpm --filter @dst-admin/api test`
Expected: PASS with compose, status, and server route coverage green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/server/service.ts apps/api/src/server/routes.ts apps/api/tests/server-routes.test.ts
git fix "补齐服务器控制接口"
```

### Task 2: Add structured server config read/write

**Files:**
- Create: `apps/api/src/config/schema.ts`
- Create: `apps/api/src/config/server-config.ts`
- Create: `apps/api/src/config/routes.ts`
- Modify: `apps/api/src/config/paths.ts`
- Modify: `apps/api/src/index.ts`
- Create: `data/cluster/admin/server-config.json`
- Test: `apps/api/tests/server-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readServerConfig, writeServerConfig } from "../src/config/server-config.js";

describe("server config", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });

  it("writes validated config and masks steam token on read", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-"));
    tempRoots.push(projectRoot);

    await writeServerConfig(projectRoot, {
      steamToken: "abc123",
      clusterName: "Test Cluster",
      clusterPassword: "secret",
      maxPlayers: 6,
      gameMode: "survival",
      enableCaves: true,
      masterPort: 10999,
      cavesPort: 11000
    });

    const result = await readServerConfig(projectRoot);

    expect(result).toMatchObject({
      steamTokenMasked: "abc***",
      clusterName: "Test Cluster",
      enableCaves: true
    });
    expect(
      JSON.parse(
        readFileSync(resolve(projectRoot, "data/cluster/admin/server-config.json"), "utf8")
      )
    ).toMatchObject({ steamToken: "abc123" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/server-config.test.ts`
Expected: FAIL because config service does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
const serverConfigSchema = z.object({
  steamToken: z.string().min(1),
  clusterName: z.string().min(1),
  clusterPassword: z.string(),
  maxPlayers: z.number().int().min(1).max(64),
  gameMode: z.enum(["survival", "endless", "wilderness"]),
  enableCaves: z.boolean(),
  masterPort: z.number().int().min(1024).max(65535),
  cavesPort: z.number().int().min(1024).max(65535)
});

export async function writeServerConfig(projectRoot: string, input: ServerConfigInput) {
  const config = serverConfigSchema.parse(input);
  await fs.mkdir(resolve(projectRoot, "data/cluster/admin"), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function readServerConfig(projectRoot: string) {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = serverConfigSchema.parse(JSON.parse(raw));
  return {
    ...parsed,
    steamTokenMasked: `${parsed.steamToken.slice(0, 3)}***`
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/server-config.test.ts`
Expected: PASS

- [ ] **Step 5: Add failing HTTP route test**

```ts
it("rejects invalid maxPlayers values through the config API", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/config", createConfigRouter(projectRoot));

  const response = await request(app).put("/api/config/server").send({
    steamToken: "abc123",
    clusterName: "Test Cluster",
    clusterPassword: "",
    maxPlayers: 0,
    gameMode: "survival",
    enableCaves: true,
    masterPort: 10999,
    cavesPort: 11000
  });

  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).not.toContain("abc123");
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/server-config.test.ts`
Expected: FAIL because router and validation error mapping are missing.

- [ ] **Step 7: Implement config router and validation-safe errors**

```ts
router.get("/server", async (_request, response, next) => {
  try {
    response.json(await readServerConfig(projectRoot));
  } catch (error) {
    next(error);
  }
});

router.put("/server", async (request, response, next) => {
  try {
    await writeServerConfig(projectRoot, request.body);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 8: Run API tests**

Run: `pnpm --filter @dst-admin/api test`
Expected: PASS with new config coverage green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/config/schema.ts apps/api/src/config/server-config.ts apps/api/src/config/routes.ts apps/api/src/config/paths.ts apps/api/src/index.ts apps/api/tests/server-config.test.ts data/cluster/admin/server-config.json
git feat "新增基础服务器配置接口"
```

### Task 3: Add raw Lua mod file editing

**Files:**
- Create: `apps/api/src/config/mod-files.ts`
- Modify: `apps/api/src/config/routes.ts`
- Create: `data/mods/dedicated_server_mods_setup.lua`
- Create: `data/mods/modoverrides.lua`
- Test: `apps/api/tests/mod-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readModFiles, writeModFiles } from "../src/config/mod-files.js";

describe("mod file service", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });

  it("persists raw lua text for both mod files", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-mods-"));
    tempRoots.push(projectRoot);

    await writeModFiles(projectRoot, {
      setup: "ServerModSetup('workshop-1')\\n",
      overrides: "return {}\\n"
    });

    expect(await readModFiles(projectRoot)).toEqual({
      setup: "ServerModSetup('workshop-1')\\n",
      overrides: "return {}\\n"
    });
    expect(
      readFileSync(resolve(projectRoot, "data/mods/modoverrides.lua"), "utf8")
    ).toBe("return {}\\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/mod-files.test.ts`
Expected: FAIL because mod file service does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function readModFiles(projectRoot: string) {
  return {
    setup: await fs.readFile(resolve(projectRoot, "data/mods/dedicated_server_mods_setup.lua"), "utf8"),
    overrides: await fs.readFile(resolve(projectRoot, "data/mods/modoverrides.lua"), "utf8")
  };
}

export async function writeModFiles(projectRoot: string, input: { setup: string; overrides: string }) {
  await fs.mkdir(resolve(projectRoot, "data/mods"), { recursive: true });
  await Promise.all([
    fs.writeFile(resolve(projectRoot, "data/mods/dedicated_server_mods_setup.lua"), input.setup),
    fs.writeFile(resolve(projectRoot, "data/mods/modoverrides.lua"), input.overrides)
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/mod-files.test.ts`
Expected: PASS

- [ ] **Step 5: Add failing route test**

```ts
it("serves and updates mod file content through the API", async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/config", createConfigRouter(projectRoot));

  const putResponse = await request(app).put("/api/config/mods").send({
    setup: "ServerModSetup('workshop-1')\\n",
    overrides: "return {}\\n"
  });

  const getResponse = await request(app).get("/api/config/mods");

  expect(putResponse.status).toBe(200);
  expect(getResponse.body).toEqual({
    setup: "ServerModSetup('workshop-1')\\n",
    overrides: "return {}\\n"
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api test apps/api/tests/mod-files.test.ts`
Expected: FAIL because `/mods` routes are missing.

- [ ] **Step 7: Implement config mod routes**

```ts
router.get("/mods", async (_request, response, next) => {
  try {
    response.json(await readModFiles(projectRoot));
  } catch (error) {
    next(error);
  }
});

router.put("/mods", async (request, response, next) => {
  try {
    await writeModFiles(projectRoot, request.body);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 8: Run API tests**

Run: `pnpm --filter @dst-admin/api test`
Expected: PASS with mod file coverage green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/config/mod-files.ts apps/api/src/config/routes.ts apps/api/tests/mod-files.test.ts data/mods/dedicated_server_mods_setup.lua data/mods/modoverrides.lua
git feat "新增模组配置编辑接口"
```

### Task 4: Build the Vue admin dashboard

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.vue`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/AppShell.vue`
- Create: `apps/web/src/components/StatusCard.vue`
- Create: `apps/web/src/components/ControlPanel.vue`
- Create: `apps/web/src/components/LogsPanel.vue`
- Create: `apps/web/src/components/ServerConfigForm.vue`
- Create: `apps/web/src/components/ModsConfigPanel.vue`
- Create: `apps/web/src/components/DocsPanel.vue`
- Test: `apps/web/src/components/*.test.ts`

- [ ] **Step 1: Write the failing UI smoke test**

```ts
import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";

import App from "../src/App.vue";

describe("App", () => {
  it("shows navigation sections for ops workflows", () => {
    render(App);

    expect(screen.getByText("总览")).toBeInTheDocument();
    expect(screen.getByText("实时日志")).toBeInTheDocument();
    expect(screen.getByText("模组配置")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/web test src/App.test.ts`
Expected: FAIL because the web app does not exist.

- [ ] **Step 3: Create minimal Vite Vue scaffold and App shell**

```ts
createApp(App).use(create({
  components: [NConfigProvider, NLayout, NLayoutSider, NLayoutContent, NMenu]
})).mount("#app");
```

```vue
<template>
  <AppShell />
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/web test src/App.test.ts`
Expected: PASS

- [ ] **Step 5: Add failing component test for API-driven controls**

```ts
it("calls the restart API after confirmation", async () => {
  const restart = vi.fn().mockResolvedValue(undefined);
  render(ControlPanel, { props: { onRestart: restart } });

  await fireEvent.click(screen.getByText("重启服务器"));
  await fireEvent.click(screen.getByText("确认"));

  expect(restart).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/web test src/components/ControlPanel.test.ts`
Expected: FAIL because the control panel and confirmation flow do not exist.

- [ ] **Step 7: Implement the dashboard components and API client**

```ts
export async function restartServer() {
  await request("/api/server/restart", { method: "POST" });
}
```

```vue
<n-popconfirm @positive-click="emit('restart')">
  <template #trigger>
    <n-button type="warning">重启服务器</n-button>
  </template>
  确认重启服务器？
</n-popconfirm>
```

- [ ] **Step 8: Run web tests**

Run: `pnpm --filter @dst-admin/web test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web
git feat "新增后台管理前端"
```

### Task 5: Add Docker deployment assets

**Files:**
- Create: `docker/dst/Dockerfile`
- Create: `docker/dst/entrypoint.sh`
- Create: `docker/dst/render-config.sh`
- Create: `docker/dst/cluster.ini.template`
- Create: `docker/dst/server.ini.template`
- Create: `docker-compose.yml`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Test: `docker compose config`

- [ ] **Step 1: Write the failing deployment validation step**

```bash
docker compose config
```

Expected: FAIL because `docker-compose.yml` does not exist yet.

- [ ] **Step 2: Create minimal Docker assets**

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y curl ca-certificates lib32gcc-s1 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dst
COPY entrypoint.sh render-config.sh ./
RUN chmod +x entrypoint.sh render-config.sh
ENTRYPOINT ["./entrypoint.sh"]
```

```yaml
services:
  admin-api:
    build:
      context: .
      dockerfile: docker/api.Dockerfile
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
```

- [ ] **Step 3: Run `docker compose config` to verify it still fails only on missing referenced files**

Run: `docker compose config`
Expected: FAIL on unresolved referenced Dockerfiles or env until each file is added.

- [ ] **Step 4: Complete the full compose stack**

```yaml
  admin-web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    ports:
      - "8080:80"

  dst-master:
    build:
      context: .
      dockerfile: docker/dst/Dockerfile
    ports:
      - "10999:10999/udp"

  dst-caves:
    build:
      context: .
      dockerfile: docker/dst/Dockerfile
    ports:
      - "11000:11000/udp"
```

- [ ] **Step 5: Run deployment validation**

Run: `docker compose config`
Expected: PASS and render merged compose output.

- [ ] **Step 6: Commit**

```bash
git add docker docker-compose.yml
git chore "补齐容器部署配置"
```

### Task 6: Finish docs and end-to-end verification

**Files:**
- Modify: `README.md`
- Create: `docs/deployment.md`
- Modify: `docs/superpowers/specs/2026-06-01-dst-steam-admin-design.md`

- [ ] **Step 1: Write the failing verification checklist**

```text
1. `pnpm install`
2. `pnpm test`
3. `pnpm build`
4. `docker compose config`
```

Expected: At least one command fails until docs and scripts are aligned with the finished repo.

- [ ] **Step 2: Update docs to match the actual repo**

```md
## Development

```bash
pnpm install
pnpm dev
```

## Deployment

```bash
docker compose up -d --build
```
```

- [ ] **Step 3: Run full verification**

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS

Run: `docker compose config`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md docs/deployment.md
git docs "完善部署与开发说明"
```

## Self-Review

- Spec coverage: server control, logs, config IO, mod file editing, web dashboard, Docker deployment, and docs are all mapped to Tasks 1-6.
- Placeholder scan: removed vague “add validation” style steps; each task names concrete files, commands, and minimal code.
- Type consistency: API uses `createServerRouter`, `createConfigRouter`, `readServerConfig`, `writeServerConfig`, `readModFiles`, and `writeModFiles` consistently across tasks.
