# 存档备份/恢复 + 就绪检测优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 DST 后台加上世界存档的备份/恢复闭环，并消除稳态下就绪检测每轮重复拉取 1000 行日志的开销。

**Architecture:** 备份/恢复是纯文件操作（admin-api 已挂载 `./data`），新增 `apps/api/src/backup/`（service + routes）挂到 `/api/backups`，前端加「存档备份」面板。就绪检测在 `server/service.ts` 加一个内存 latch，已就绪后跳过日志扫描，容器非运行或用户操作时失效。

**Tech Stack:** Express ESM (TS NodeNext，相对 import 带 `.js`)、zod、`tar` (npm 包)、Vue 3 + Naive UI、vitest。

设计文档：`docs/superpowers/specs/2026-06-05-save-backup-and-readiness-design.md`

---

## 文件结构

**新增**
- `apps/api/src/backup/service.ts` — 备份业务逻辑（list/create/restore/delete/resolvePath + `BackupError`）
- `apps/api/src/backup/routes.ts` — `/api/backups` 路由
- `apps/api/tests/backup-service.test.ts` — service 单测（临时目录）
- `apps/api/tests/backup-routes.test.ts` — 路由状态码单测
- `apps/api/tests/status-service.test.ts` — 就绪 latch 单测
- `apps/web/src/components/BackupPanel.vue` — 备份面板
- `apps/web/src/components/BackupPanel.test.ts` — 面板单测

**修改**
- `apps/api/src/server/service.ts` — 加就绪 latch
- `apps/api/src/index.ts` — 挂载 backup 路由
- `apps/api/package.json` — 加 `tar` 依赖
- `apps/web/src/api/client.ts` — backup 方法 + 错误消息解析
- `apps/web/src/components/AppShell.vue` — 侧边栏新增「存档备份」

> 提交沿用仓库习惯的 git alias（`git feat/fix/test/docs "中文描述"`），它会生成 `[type] 描述` 形式的提交信息。每个 alias 提交前自行 `git add` 相关文件。

---

## Task 1: 就绪检测 latch

**Files:**
- Modify: `apps/api/src/server/service.ts`
- Test: `apps/api/tests/status-service.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/tests/status-service.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const runComposeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/docker/compose.js", () => ({ runCompose: runComposeMock }));

import { __resetReadyLatch, getServerStatus, runServerAction } from "../src/server/service.js";

const RUNNING_STATUS = JSON.stringify([
  { Service: "dst-master", Name: "x-dst-master-1", State: "running", Status: "Up 1 minute", Publishers: null },
  { Service: "dst-caves", Name: "x-dst-caves-1", State: "running", Status: "Up 1 minute", Publishers: null }
]);
const STOPPED_STATUS = JSON.stringify([
  { Service: "dst-master", Name: "x-dst-master-1", State: "exited", Status: "Exited", Publishers: null },
  { Service: "dst-caves", Name: "x-dst-caves-1", State: "exited", Status: "Exited", Publishers: null }
]);
const READY_LOGS = "Starting DST shard Master\n[00:06:59]: Server registered via geo DNS in ap-southeast-1";
const STARTING_LOGS = "Starting DST shard Master\n[00:00:00]: loaded modindex";

function mockCompose(statusOut: string, logsOut = STARTING_LOGS) {
  runComposeMock.mockImplementation(async (action: string) => {
    if (action === "logs") return { stdout: logsOut, stderr: "" };
    return { stdout: statusOut, stderr: "" };
  });
}

function logCalls() {
  return runComposeMock.mock.calls.filter(([action]) => action === "logs");
}

beforeEach(() => {
  runComposeMock.mockReset();
  __resetReadyLatch();
});

describe("getServerStatus readiness latch", () => {
  it("首次 running 轮询扫描日志，就绪则返回 running", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    const status = await getServerStatus("/root");
    expect(status.overall).toBe("running");
    expect(runComposeMock).toHaveBeenCalledWith("logs", "/root", "1000");
  });

  it("latch 置位后后续 running 轮询不再扫描日志", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    await getServerStatus("/root");
    runComposeMock.mockClear();
    const status = await getServerStatus("/root");
    expect(status.overall).toBe("running");
    expect(logCalls()).toHaveLength(0);
  });

  it("无就绪标记时返回 starting 且不置位 latch", async () => {
    mockCompose(RUNNING_STATUS, STARTING_LOGS);
    expect((await getServerStatus("/root")).overall).toBe("starting");
    runComposeMock.mockClear();
    expect((await getServerStatus("/root")).overall).toBe("starting");
    expect(logCalls()).toHaveLength(1);
  });

  it("容器不再运行时 latch 失效，再次 running 会重扫", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    await getServerStatus("/root");
    mockCompose(STOPPED_STATUS, READY_LOGS);
    expect((await getServerStatus("/root")).overall).toBe("stopped");
    mockCompose(RUNNING_STATUS, READY_LOGS);
    runComposeMock.mockClear();
    await getServerStatus("/root");
    expect(logCalls()).toHaveLength(1);
  });

  it("执行 server action 后 latch 失效", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    await getServerStatus("/root");
    await runServerAction("/root", "restart");
    mockCompose(RUNNING_STATUS, READY_LOGS);
    runComposeMock.mockClear();
    await getServerStatus("/root");
    expect(logCalls()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/status-service.test.ts`
Expected: FAIL（`__resetReadyLatch` 未导出 / latch 行为不存在，多个用例失败）

- [ ] **Step 3: 改 `service.ts` 加 latch**

把 `apps/api/src/server/service.ts` 的 `getServerStatus` 与 `runServerAction` 替换为下面版本（保留文件顶部 import 与 `readyMarkersFromEnv`）：

```ts
let readyLatched = false;

// 仅供测试：重置就绪 latch
export function __resetReadyLatch(): void {
  readyLatched = false;
}

export async function getServerStatus(projectRoot: string) {
  const result = await runCompose("status", projectRoot);
  const status = parseComposeStatus(result.stdout);

  // 容器一旦不再全部运行，下一轮必须重新判定就绪
  if (status.overall !== "running") {
    readyLatched = false;
    return status;
  }

  // 已确认就绪：稳态下跳过昂贵的日志扫描
  if (readyLatched) {
    return status;
  }

  // 容器 running 但游戏进程可能仍在加载世界，读日志确认就绪标记
  const logs = await runCompose("logs", projectRoot, "1000");
  if (isServerReady(logs.stdout, readyMarkersFromEnv())) {
    readyLatched = true;
    return status;
  }

  return { ...status, overall: "starting" as const };
}

export async function runServerAction(
  projectRoot: string,
  action: "start" | "stop" | "restart"
) {
  await runCompose(action, projectRoot, undefined);
  // 用户主动启停后强制下一轮重新判定就绪
  readyLatched = false;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/status-service.test.ts`
Expected: PASS（5 个用例全过）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/server/service.ts apps/api/tests/status-service.test.ts
git perf "就绪检测加内存 latch，稳态跳过日志扫描"
```

---

## Task 2: 备份 service — 依赖、类型、createBackup、listBackups

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/backup/service.ts`
- Test: `apps/api/tests/backup-service.test.ts`

- [ ] **Step 1: 安装 `tar` 依赖**

Run: `pnpm --filter @dst-admin/api add tar`
Expected: `apps/api/package.json` 的 dependencies 出现 `"tar": "^7.x"`（tar v7 自带类型，无需 @types/tar）

- [ ] **Step 2: 写失败测试**

创建 `apps/api/tests/backup-service.test.ts`：

```ts
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runComposeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/docker/compose.js", () => ({ runCompose: runComposeMock }));

import { createBackup, listBackups } from "../src/backup/service.js";

let projectRoot: string;

const SAVE_REL = "data/cluster/DoNotStarveTogether/Cluster";

async function seedSave(files: Record<string, string>) {
  const dir = resolve(projectRoot, SAVE_REL);
  await fs.mkdir(resolve(dir, "Master/save"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = resolve(dir, rel);
    await fs.mkdir(resolve(full, ".."), { recursive: true });
    await fs.writeFile(full, content);
  }
}

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(resolve(tmpdir(), "dst-backup-"));
  runComposeMock.mockReset();
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe("createBackup", () => {
  it("打包世界存档但排除 cluster_token.txt", async () => {
    await seedSave({
      "cluster.ini": "[NETWORK]",
      "cluster_token.txt": "SECRET",
      "Master/save/session": "world"
    });

    const entry = await createBackup(projectRoot);

    expect(entry.name).toMatch(/^dst-save-\d{8}-\d{6}\.tar\.gz$/);
    expect(entry.size).toBeGreaterThan(0);

    // 解开归档核对内容
    const extractDir = resolve(projectRoot, "extract");
    await fs.mkdir(extractDir);
    const tar = await import("tar");
    await tar.extract({ file: resolve(projectRoot, "data/backups", entry.name), cwd: extractDir });
    await expect(fs.access(resolve(extractDir, "cluster.ini"))).resolves.toBeUndefined();
    await expect(fs.access(resolve(extractDir, "Master/save/session"))).resolves.toBeUndefined();
    await expect(fs.access(resolve(extractDir, "cluster_token.txt"))).rejects.toThrow();
  });

  it("带 label 时文件名包含 slug", async () => {
    await seedSave({ "cluster.ini": "x" });
    const entry = await createBackup(projectRoot, "Boss Fight!");
    expect(entry.name).toMatch(/^dst-save-\d{8}-\d{6}-boss-fight\.tar\.gz$/);
  });

  it("存档为空时报错", async () => {
    await expect(createBackup(projectRoot)).rejects.toThrow("暂无可备份的存档");
  });
});

describe("listBackups", () => {
  it("目录不存在返回空数组", async () => {
    expect(await listBackups(projectRoot)).toEqual([]);
  });

  it("按时间倒序列出 .tar.gz 并忽略其他文件", async () => {
    const dir = resolve(projectRoot, "data/backups");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolve(dir, "dst-save-20260101-000000.tar.gz"), "a");
    await fs.writeFile(resolve(dir, "dst-save-20260202-000000.tar.gz"), "bb");
    await fs.writeFile(resolve(dir, "notes.txt"), "ignore");

    const items = await listBackups(projectRoot);

    expect(items.map((i) => i.name)).toEqual([
      "dst-save-20260202-000000.tar.gz",
      "dst-save-20260101-000000.tar.gz"
    ]);
    expect(items[0].size).toBe(2);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-service.test.ts`
Expected: FAIL（`../src/backup/service.js` 不存在）

- [ ] **Step 4: 创建 `service.ts`（含本任务用到的部分）**

创建 `apps/api/src/backup/service.ts`：

```ts
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import * as tar from "tar";

export interface BackupEntry {
  name: string;
  createdAt: string; // ISO
  size: number; // bytes
}

export class BackupError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BackupError";
  }
}

const NAME_PATTERN = /^[\w.-]+\.tar\.gz$/;
const TOKEN_FILENAME = "cluster_token.txt";

function saveDir(projectRoot: string): string {
  return resolve(projectRoot, "data/cluster/DoNotStarveTogether/Cluster");
}

function backupDir(projectRoot: string): string {
  return resolve(projectRoot, "data/backups");
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function slugLabel(label?: string): string {
  if (!label) return "";
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug ? `-${slug}` : "";
}

export async function listBackups(projectRoot: string): Promise<BackupEntry[]> {
  const dir = backupDir(projectRoot);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const items: BackupEntry[] = [];
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) continue;
    const stat = await fs.stat(resolve(dir, name));
    if (!stat.isFile()) continue;
    items.push({ name, createdAt: stat.mtime.toISOString(), size: stat.size });
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(
  projectRoot: string,
  label?: string
): Promise<BackupEntry> {
  const src = saveDir(projectRoot);
  let entries: string[];
  try {
    entries = (await fs.readdir(src)).filter((entry) => entry !== TOKEN_FILENAME);
  } catch {
    entries = [];
  }
  if (entries.length === 0) {
    throw new BackupError("暂无可备份的存档", 409);
  }

  const dir = backupDir(projectRoot);
  await fs.mkdir(dir, { recursive: true });
  const name = `dst-save-${timestamp()}${slugLabel(label)}.tar.gz`;
  const file = resolve(dir, name);
  await tar.create({ gzip: true, file, cwd: src }, entries);

  const stat = await fs.stat(file);
  return { name, createdAt: stat.mtime.toISOString(), size: stat.size };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-service.test.ts`
Expected: PASS（createBackup 3 项 + listBackups 2 项）

- [ ] **Step 6: 提交**

```bash
git add apps/api/package.json apps/api/src/backup/service.ts apps/api/tests/backup-service.test.ts ../../pnpm-lock.yaml
git feat "新增存档备份 service：tar 打包与列表"
```

> 注：`pnpm-lock.yaml` 在仓库根；若 `git add ../../pnpm-lock.yaml` 路径不便，可在仓库根执行 `git add pnpm-lock.yaml`。

---

## Task 3: 备份 service — resolveBackupPath + deleteBackup

**Files:**
- Modify: `apps/api/src/backup/service.ts`
- Test: `apps/api/tests/backup-service.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `apps/api/tests/backup-service.test.ts` 末尾追加（并在顶部 import 增加 `deleteBackup, resolveBackupPath`）：

```ts
import { deleteBackup, resolveBackupPath } from "../src/backup/service.js";

describe("resolveBackupPath", () => {
  it("合法名返回 data/backups 内的绝对路径", () => {
    const path = resolveBackupPath(projectRoot, "dst-save-20260101-000000.tar.gz");
    expect(path).toBe(
      resolve(projectRoot, "data/backups", "dst-save-20260101-000000.tar.gz")
    );
  });

  it("非法名（路径穿越/非 tar.gz）抛 400", () => {
    expect(() => resolveBackupPath(projectRoot, "../secret")).toThrow();
    expect(() => resolveBackupPath(projectRoot, "evil.sh")).toThrow();
    expect(() => resolveBackupPath(projectRoot, "a/b.tar.gz")).toThrow();
  });
});

describe("deleteBackup", () => {
  it("删除存在的备份", async () => {
    const dir = resolve(projectRoot, "data/backups");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolve(dir, "dst-save-20260101-000000.tar.gz"), "a");
    await deleteBackup(projectRoot, "dst-save-20260101-000000.tar.gz");
    await expect(
      fs.access(resolve(dir, "dst-save-20260101-000000.tar.gz"))
    ).rejects.toThrow();
  });

  it("删除不存在的备份抛 404", async () => {
    await expect(
      deleteBackup(projectRoot, "dst-save-20260101-000000.tar.gz")
    ).rejects.toMatchObject({ status: 404 });
  });
});
```

> 顶部已有一条 `import { createBackup, listBackups } from "../src/backup/service.js";`，把它合并成
> `import { createBackup, deleteBackup, listBackups, resolveBackupPath } from "../src/backup/service.js";`

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-service.test.ts`
Expected: FAIL（`resolveBackupPath`、`deleteBackup` 未导出）

- [ ] **Step 3: 在 `service.ts` 增加函数**

在 `apps/api/src/backup/service.ts` 顶部 import 增加 `isAbsolute, relative`：

```ts
import { isAbsolute, relative, resolve } from "node:path";
```

并追加：

```ts
export function resolveBackupPath(projectRoot: string, name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new BackupError("无效的备份文件名", 400);
  }
  const dir = backupDir(projectRoot);
  const full = resolve(dir, name);
  const rel = relative(dir, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new BackupError("无效的备份文件名", 400);
  }
  return full;
}

export async function deleteBackup(projectRoot: string, name: string): Promise<void> {
  const path = resolveBackupPath(projectRoot, name);
  try {
    await fs.unlink(path);
  } catch {
    throw new BackupError("备份不存在", 404);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-service.test.ts`
Expected: PASS（新增 4 项全过）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/backup/service.ts apps/api/tests/backup-service.test.ts
git feat "备份 service 支持路径校验与删除"
```

---

## Task 4: 备份 service — restoreBackup

**Files:**
- Modify: `apps/api/src/backup/service.ts`
- Test: `apps/api/tests/backup-service.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `apps/api/tests/backup-service.test.ts` 顶部 import 合并 `restoreBackup`，末尾追加：

```ts
const STOPPED = JSON.stringify([
  { Service: "dst-master", State: "exited", Status: "Exited", Publishers: null },
  { Service: "dst-caves", State: "exited", Status: "Exited", Publishers: null }
]);
const RUNNING = JSON.stringify([
  { Service: "dst-master", State: "running", Status: "Up", Publishers: null },
  { Service: "dst-caves", State: "running", Status: "Up", Publishers: null }
]);

describe("restoreBackup", () => {
  it("服务器运行中时拒绝并抛 409", async () => {
    runComposeMock.mockResolvedValue({ stdout: RUNNING, stderr: "" });
    await seedSave({ "cluster.ini": "x" });
    const { name } = await createBackup(projectRoot);
    await expect(restoreBackup(projectRoot, name)).rejects.toMatchObject({ status: 409 });
  });

  it("保留 cluster_token.txt 并完整替换世界内容", async () => {
    runComposeMock.mockResolvedValue({ stdout: STOPPED, stderr: "" });
    // 旧存档：含 token、一份旧世界、一份将被备份排除后又被恢复清掉的多余文件
    await seedSave({ "cluster.ini": "OLD", "cluster_token.txt": "SECRET", "stale.txt": "remove-me" });
    const { name } = await createBackup(projectRoot); // 归档含 cluster.ini + stale.txt（不含 token）

    // 改动当前存档：删掉 cluster.ini、改 token、加一个备份里没有的新文件
    const src = resolve(projectRoot, SAVE_REL);
    await fs.rm(resolve(src, "cluster.ini"));
    await fs.writeFile(resolve(src, "cluster_token.txt"), "KEPT");
    await fs.writeFile(resolve(src, "after-backup.txt"), "should-be-gone");

    await restoreBackup(projectRoot, name);

    // 世界文件恢复
    expect(await fs.readFile(resolve(src, "cluster.ini"), "utf8")).toBe("OLD");
    // 备份后新增、且不在归档里的文件被清掉
    await expect(fs.access(resolve(src, "after-backup.txt"))).rejects.toThrow();
    // token 不受归档影响，保留当前磁盘上的值
    expect(await fs.readFile(resolve(src, "cluster_token.txt"), "utf8")).toBe("KEPT");
  });

  it("恢复不存在的备份抛 404", async () => {
    runComposeMock.mockResolvedValue({ stdout: STOPPED, stderr: "" });
    await expect(
      restoreBackup(projectRoot, "dst-save-20260101-000000.tar.gz")
    ).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-service.test.ts`
Expected: FAIL（`restoreBackup` 未导出）

- [ ] **Step 3: 在 `service.ts` 增加 restoreBackup**

在 `apps/api/src/backup/service.ts` 顶部增加 import：

```ts
import { runCompose } from "../docker/compose.js";
import { parseComposeStatus } from "../docker/status.js";
```

追加函数：

```ts
export async function restoreBackup(projectRoot: string, name: string): Promise<void> {
  const archive = resolveBackupPath(projectRoot, name);
  try {
    await fs.access(archive);
  } catch {
    throw new BackupError("备份不存在", 404);
  }

  // 仅看容器状态，不读日志：要求两个分片都已停止
  const statusResult = await runCompose("status", projectRoot);
  if (parseComposeStatus(statusResult.stdout).overall !== "stopped") {
    throw new BackupError("请先停止服务器再恢复", 409);
  }

  const src = saveDir(projectRoot);
  await fs.mkdir(src, { recursive: true });

  // 暂存当前 token，恢复后写回（备份包不含 token）
  let token: string | null = null;
  try {
    token = await fs.readFile(resolve(src, TOKEN_FILENAME), "utf8");
  } catch {
    token = null;
  }

  const tmp = resolve(
    backupDir(projectRoot),
    `.restore-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await fs.mkdir(tmp, { recursive: true });
  try {
    await tar.extract({ file: archive, cwd: tmp });
    const extracted = await fs.readdir(tmp);
    if (extracted.length === 0) {
      throw new BackupError("备份文件已损坏或为空", 422);
    }

    // 清空现有存档，但保留 token
    for (const entry of await fs.readdir(src)) {
      if (entry === TOKEN_FILENAME) continue;
      await fs.rm(resolve(src, entry), { recursive: true, force: true });
    }
    // 移入解压内容
    for (const entry of extracted) {
      await fs.rename(resolve(tmp, entry), resolve(src, entry));
    }
    // 若原先有 token 而恢复内容未带，则写回
    if (token !== null) {
      try {
        await fs.access(resolve(src, TOKEN_FILENAME));
      } catch {
        await fs.writeFile(resolve(src, TOKEN_FILENAME), token);
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-service.test.ts`
Expected: PASS（restoreBackup 3 项全过）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/backup/service.ts apps/api/tests/backup-service.test.ts
git feat "备份 service 支持恢复：停服校验、保留 token、完整替换世界"
```

---

## Task 5: 备份路由 + 挂载

**Files:**
- Create: `apps/api/src/backup/routes.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/backup-routes.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/tests/backup-routes.test.ts`（沿用 `server-routes.test.ts` 的轻量路由调用风格，并 mock service 层）：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const listBackupsMock = vi.hoisted(() => vi.fn());
const createBackupMock = vi.hoisted(() => vi.fn());
const restoreBackupMock = vi.hoisted(() => vi.fn());
const deleteBackupMock = vi.hoisted(() => vi.fn());

class BackupError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BackupError";
  }
}

vi.mock("../src/backup/service.js", () => ({
  BackupError,
  listBackups: listBackupsMock,
  createBackup: createBackupMock,
  restoreBackup: restoreBackupMock,
  deleteBackup: deleteBackupMock,
  resolveBackupPath: vi.fn()
}));

import { createBackupRouter } from "../src/backup/routes.js";

interface HandleRouter {
  handle: (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
}

async function call(
  path: string,
  method: string,
  body?: unknown,
  params: Record<string, string> = {}
) {
  const router = createBackupRouter(process.cwd()) as unknown as HandleRouter;
  const request = { method, url: path, originalUrl: path, path, query: {}, params, body };
  const state: { status: number; body?: unknown } = { status: 200 };
  await new Promise<void>((resolve, reject) => {
    const response = {
      status(code: number) { state.status = code; return this; },
      json(payload: unknown) { state.body = payload; resolve(); return this; }
    };
    router.handle(request as never, response as never, (error?: unknown) =>
      error ? reject(error) : resolve()
    );
  });
  return state;
}

afterEach(() => vi.clearAllMocks());

describe("backup routes", () => {
  it("GET / 返回列表", async () => {
    listBackupsMock.mockResolvedValue([{ name: "a.tar.gz", createdAt: "x", size: 1 }]);
    const res = await call("/", "GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ name: "a.tar.gz", createdAt: "x", size: 1 }] });
  });

  it("POST / 创建并返回条目", async () => {
    createBackupMock.mockResolvedValue({ name: "a.tar.gz", createdAt: "x", size: 1 });
    const res = await call("/", "POST", { label: "snap" });
    expect(res.status).toBe(200);
    expect(createBackupMock).toHaveBeenCalledWith(process.cwd(), "snap");
  });

  it("POST /:name/restore 运行中返回 409", async () => {
    restoreBackupMock.mockRejectedValue(new BackupError("请先停止服务器再恢复", 409));
    const res = await call("/a.tar.gz/restore", "POST", undefined, { name: "a.tar.gz" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "请先停止服务器再恢复" });
  });

  it("DELETE /:name 不存在返回 404", async () => {
    deleteBackupMock.mockRejectedValue(new BackupError("备份不存在", 404));
    const res = await call("/a.tar.gz", "DELETE", undefined, { name: "a.tar.gz" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "备份不存在" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-routes.test.ts`
Expected: FAIL（`../src/backup/routes.js` 不存在）

- [ ] **Step 3: 创建 `routes.ts`**

创建 `apps/api/src/backup/routes.ts`：

```ts
import type { NextFunction, Response } from "express";
import { Router } from "express";

import {
  BackupError,
  createBackup,
  deleteBackup,
  listBackups,
  resolveBackupPath,
  restoreBackup
} from "./service.js";

function handleError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof BackupError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

export function createBackupRouter(projectRoot: string): Router {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      response.json({ items: await listBackups(projectRoot) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const label =
        typeof request.body?.label === "string" ? request.body.label : undefined;
      response.json(await createBackup(projectRoot, label));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post("/:name/restore", async (request, response, next) => {
    try {
      await restoreBackup(projectRoot, request.params.name);
      response.json({ ok: true });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.delete("/:name", async (request, response, next) => {
    try {
      await deleteBackup(projectRoot, request.params.name);
      response.json({ ok: true });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get("/:name/download", (request, response, next) => {
    try {
      response.download(resolveBackupPath(projectRoot, request.params.name));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
}
```

- [ ] **Step 4: 在 `index.ts` 挂载路由**

修改 `apps/api/src/index.ts`：在 import 段加入

```ts
import { createBackupRouter } from "./backup/routes.js";
```

在 `app.use("/api/config", createConfigRouter(projectRoot));` 之后加入：

```ts
  app.use("/api/backups", createBackupRouter(projectRoot));
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/backup-routes.test.ts`
Expected: PASS（4 项）

- [ ] **Step 6: 跑全量 api 测试 + lint**

Run: `pnpm --filter @dst-admin/api test && pnpm --filter @dst-admin/api lint`
Expected: 全绿，无类型错误

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/backup/routes.ts apps/api/src/index.ts apps/api/tests/backup-routes.test.ts
git feat "新增 /api/backups 路由并挂载"
```

---

## Task 6: 前端 client 方法 + 错误消息解析

**Files:**
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: 改进 `request` 的错误解析**

修改 `apps/web/src/api/client.ts` 的 `request` 函数错误分支，把

```ts
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }
```

替换为：

```ts
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
```

- [ ] **Step 2: 追加 backup API 方法**

在 `apps/web/src/api/client.ts` 末尾追加：

```ts
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
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @dst-admin/web lint`
Expected: PASS（vue-tsc 无错误）

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/api/client.ts
git feat "前端新增备份 API 方法并解析后端错误消息"
```

---

## Task 7: BackupPanel 组件 + AppShell 接入

**Files:**
- Create: `apps/web/src/components/BackupPanel.vue`
- Modify: `apps/web/src/components/AppShell.vue`
- Test: `apps/web/src/components/BackupPanel.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/BackupPanel.test.ts`：

```ts
import { mount } from "@vue/test-utils";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

vi.mock("../api/client", () => ({
  listBackups: vi.fn(async () => ({
    items: [{ name: "dst-save-20260605-120000.tar.gz", createdAt: "2026-06-05T12:00:00.000Z", size: 2048 }]
  })),
  createBackup: vi.fn(async () => ({ name: "new.tar.gz", createdAt: "x", size: 1 })),
  restoreBackup: vi.fn(async () => undefined),
  deleteBackup: vi.fn(async () => undefined),
  backupDownloadUrl: (name: string) => `/api/backups/${name}/download`
}));

import * as client from "../api/client";
import BackupPanel from "./BackupPanel.vue";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mountPanel(attachTo?: HTMLElement) {
  const Wrapper = defineComponent({
    render() {
      return h(NMessageProvider, null, { default: () => h(BackupPanel) });
    }
  });
  return mount(Wrapper, attachTo ? { attachTo } : {});
}

describe("BackupPanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("挂载后渲染备份列表", async () => {
    const wrapper = mountPanel();
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("dst-save-20260605-120000.tar.gz");
    expect(wrapper.text()).toContain("2.0 KB");
  });

  it("点击立即备份调用 createBackup", async () => {
    const wrapper = mountPanel();
    await flush();
    await wrapper.vm.$nextTick();
    const buttons = wrapper.findAll("button");
    const createBtn = buttons.find((b) => b.text().includes("立即备份"))!;
    await createBtn.trigger("click");
    await flush();
    expect(client.createBackup).toHaveBeenCalled();
  });

  it("确认恢复调用 restoreBackup", async () => {
    const wrapper = mountPanel(document.body);
    await flush();
    await wrapper.vm.$nextTick();
    const restoreBtn = wrapper.get(
      '[data-testid="restore-dst-save-20260605-120000.tar.gz"]'
    );
    await restoreBtn.trigger("click");
    const confirm = document.body.querySelector(
      ".n-popconfirm__action .n-button--primary-type"
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    confirm?.click();
    await flush();
    expect(client.restoreBackup).toHaveBeenCalledWith("dst-save-20260605-120000.tar.gz");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/web exec vitest run src/components/BackupPanel.test.ts`
Expected: FAIL（`./BackupPanel.vue` 不存在）

- [ ] **Step 3: 创建 `BackupPanel.vue`**

创建 `apps/web/src/components/BackupPanel.vue`：

```vue
<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>存档备份</span>
        <span class="section-subtitle">备份与恢复世界存档（不含 Steam 密钥）</span>
      </div>
    </template>

    <div class="create-row">
      <n-input v-model:value="label" placeholder="可选备注，如 before-boss" />
      <n-button type="primary" :loading="creating" @click="onCreate">立即备份</n-button>
    </div>

    <n-spin :show="loading">
      <n-empty v-if="items.length === 0" description="暂无备份" class="empty" />
      <n-list v-else bordered>
        <n-list-item v-for="item in items" :key="item.name">
          <div class="row">
            <div class="info">
              <span class="name">{{ item.name }}</span>
              <span class="meta">{{ formatTime(item.createdAt) }} · {{ formatSize(item.size) }}</span>
            </div>
            <div class="actions">
              <n-popconfirm @positive-click="() => onRestore(item)">
                <template #trigger>
                  <n-button quaternary size="small" :data-testid="`restore-${item.name}`">恢复</n-button>
                </template>
                恢复会覆盖当前世界存档，且需先停止服务器。确认恢复？
              </n-popconfirm>
              <n-button quaternary size="small" tag="a" :href="downloadUrl(item.name)" download>下载</n-button>
              <n-popconfirm @positive-click="() => onDelete(item)">
                <template #trigger>
                  <n-button quaternary type="error" size="small" :data-testid="`delete-${item.name}`">删除</n-button>
                </template>
                确认删除该备份？
              </n-popconfirm>
            </div>
          </div>
        </n-list-item>
      </n-list>
    </n-spin>
  </n-card>
</template>

<script setup lang="ts">
import {
  NButton,
  NCard,
  NEmpty,
  NInput,
  NList,
  NListItem,
  NPopconfirm,
  NSpin,
  useMessage
} from "naive-ui";
import { onMounted, ref } from "vue";

import {
  backupDownloadUrl,
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  type BackupEntry
} from "../api/client";

const message = useMessage();
const items = ref<BackupEntry[]>([]);
const loading = ref(false);
const creating = ref(false);
const label = ref("");

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function downloadUrl(name: string) {
  return backupDownloadUrl(name);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

async function refresh() {
  loading.value = true;
  try {
    items.value = (await listBackups()).items;
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  creating.value = true;
  try {
    await createBackup(label.value.trim() || undefined);
    label.value = "";
    message.success("备份已创建");
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    creating.value = false;
  }
}

async function onRestore(item: BackupEntry) {
  try {
    await restoreBackup(item.name);
    message.success("已从备份恢复");
  } catch (error) {
    message.error(asMessage(error));
  }
}

async function onDelete(item: BackupEntry) {
  try {
    await deleteBackup(item.name);
    message.success("已删除备份");
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  }
}

onMounted(refresh);
</script>

<style scoped>
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.info {
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 600;
  word-break: break-all;
}
.meta {
  font-size: 12px;
  opacity: 0.7;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.empty {
  padding: 24px 0;
}
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @dst-admin/web exec vitest run src/components/BackupPanel.test.ts`
Expected: PASS（3 项）

- [ ] **Step 5: 在 AppShell 接入侧边栏**

修改 `apps/web/src/components/AppShell.vue`：

(a) 模板内容区，在 `<section v-else-if="activeSection === 'mods'" ...>...</section>` 之后、`<section v-else class="page">`（DocsPanel）之前插入：

```vue
      <section v-else-if="activeSection === 'backup'" class="page">
        <BackupPanel />
      </section>
```

(b) lucide 图标 import 增加 `Archive`：

```ts
import { TerminalSquare, ScrollText, Cog, Puzzle, Archive, BookOpenText } from "lucide-vue-next";
```

(c) 组件 import 增加：

```ts
import BackupPanel from "./BackupPanel.vue";
```

(d) `SectionKey` 类型加入 `"backup"`：

```ts
type SectionKey = "overview" | "logs" | "config" | "mods" | "backup" | "docs";
```

(e) `menuOptions` 在「模组配置」与「部署说明」之间加入：

```ts
  { label: "存档备份", key: "backup", icon: renderIcon(Archive) },
```

(f) `heroMeta` 加入：

```ts
  backup: { title: "存档备份", copy: "备份、恢复、下载世界存档（恢复需先停服）。" },
```

- [ ] **Step 6: 类型检查 + 全量 web 测试**

Run: `pnpm --filter @dst-admin/web lint && pnpm --filter @dst-admin/web test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/BackupPanel.vue apps/web/src/components/BackupPanel.test.ts apps/web/src/components/AppShell.vue
git feat "新增存档备份面板并接入侧边栏"
```

---

## Task 8: 全量验证

- [ ] **Step 1: 根目录跑全部测试与 lint**

Run: `pnpm test && pnpm lint`
Expected: api + web 全部测试通过，类型检查无错误

- [ ] **Step 2: 构建确认**

Run: `pnpm build`
Expected: 两个包均构建成功（确认 `tar` 在 api 构建产物中正常解析）

- [ ] **Step 3: 若有未提交改动，补一次提交**

```bash
git status --short
# 若有遗漏文件
git add <files>
git chore "补充存档备份/就绪优化相关改动"
```

---

## Self-Review 记录

- **Spec 覆盖**：组件一（list/create/restore/delete/download，token 排除与保留、停服校验、name 校验、前端面板与侧边栏）→ Task 2–7；组件二（latch 跳过扫描、非运行/动作失效、保留 1000 行、测试）→ Task 1。Backlog 章节为非本次范围，无需任务。✓
- **占位符**：无 TBD/TODO，所有步骤含完整代码与命令。✓
- **类型一致**：`BackupEntry { name; createdAt; size }` 在 api service、api 路由测试、web client、web 组件一致；`BackupError.status` 一致；函数名 `listBackups/createBackup/restoreBackup/deleteBackup/resolveBackupPath` 全程一致；`__resetReadyLatch` 在 service 与测试一致。✓
- **注意**：`tar` 选用 v7（自带类型，`import * as tar from "tar"` 使用 `tar.create`/`tar.extract`）；`pnpm-lock.yaml` 在仓库根，Task 2 提交时按实际路径 `git add`。
