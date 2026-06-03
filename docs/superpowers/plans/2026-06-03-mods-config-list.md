# 模组配置结构化列表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留原文编辑的前提下，为模组配置面板新增结构化模组列表，支持删除、启用/禁用、查看配置、按 ID 新增并自动解析 Steam 名称。

**Architecture:** 后端用零依赖的「深度切分」纯函数解析 `dedicated_server_mods_setup.lua` 与 `modoverrides.lua`，把内层 `configuration_options` 当作原始字符串块保留；名称由 Steam Workshop 官方接口解析并落地磁盘缓存。新增 4 个 `/api/config/mods*` 端点，保留原有 `GET/PUT /mods` 原文编辑。前端 `ModsConfigPanel.vue` 改为「列表 + 高级原文编辑折叠区」。

**Tech Stack:** Node 22 / Express ESM（相对 import 带 `.js`）、Vitest、Vue 3 + Naive UI、@vue/test-utils（jsdom）。

---

## 约定提醒

- API 是 ESM：相对 import 必须带 `.js` 扩展名（源文件是 `.ts`）。
- API 测试在 `apps/api/tests/**/*.test.ts`（node 环境）；Web 测试与源码同目录（jsdom）。
- 运行单个 api 测试：`pnpm --filter @dst-admin/api exec vitest run tests/xxx.test.ts`
- 运行单个 web 测试：`pnpm --filter @dst-admin/web exec vitest run src/components/Xxx.test.ts`
- 提交用全局 alias：`git feat "中文描述"` / `git test "中文描述"`（自动从分支名提取 ticket）。

## 文件结构

- 新建 `apps/api/src/config/mods-parser.ts` — 纯函数：解析与增删改两个 Lua 文件文本（无 IO）。
- 新建 `apps/api/src/config/mod-names.ts` — Steam 名称解析 + 磁盘缓存。
- 修改 `apps/api/src/config/routes.ts` — 新增 4 个端点。
- 新建 `apps/api/tests/mods-parser.test.ts` — 纯函数单测（重点）。
- 修改 `apps/api/tests/mod-files.test.ts` — 新端点集成测试。
- 修改 `apps/web/src/api/client.ts` — 新类型与请求函数。
- 修改 `apps/web/src/components/ModsConfigPanel.vue` — 列表 + 高级折叠区。
- 新建 `apps/web/src/components/ModsConfigPanel.test.ts` — 组件测试。

> setup 文件真实格式为 `ServerModSetup("123456")`（纯数字 ID）；overrides 用 `["workshop-123456"]`。解析一律归一化为纯数字 ID，正则容忍可选 `workshop-` 前缀。

---

## Task 1: 解析 setup 文件与 ID 归一化

**Files:**
- Create: `apps/api/src/config/mods-parser.ts`
- Test: `apps/api/tests/mods-parser.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/tests/mods-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizeModId, parseSetup } from "../src/config/mods-parser.js";

describe("parseSetup", () => {
  it("提取纯数字 ID，并容忍 workshop- 前缀与单双引号", () => {
    const text = [
      "-- comment",
      'ServerModSetup("378160973")',
      "ServerModSetup('workshop-123456')",
      ""
    ].join("\n");
    expect(parseSetup(text)).toEqual(["378160973", "123456"]);
  });

  it("空内容返回空数组", () => {
    expect(parseSetup("")).toEqual([]);
  });
});

describe("normalizeModId", () => {
  it("去掉 workshop- 前缀，非法输入返回 null", () => {
    expect(normalizeModId("workshop-42")).toBe("42");
    expect(normalizeModId("  99 ")).toBe("99");
    expect(normalizeModId("abc")).toBeNull();
    expect(normalizeModId(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mods-parser.test.ts`
Expected: FAIL（找不到模块 `mods-parser.js` / 函数未定义）

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/config/mods-parser.ts`:

```ts
export class ModParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModParseError";
  }
}

const SETUP_RE = /ServerModSetup\(\s*["'](?:workshop-)?(\d+)["']\s*\)/g;

export function parseSetup(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(SETUP_RE)) {
    ids.push(match[1]);
  }
  return ids;
}

export function normalizeModId(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") {
    return null;
  }
  const trimmed = String(input).trim().replace(/^workshop-/, "");
  return /^\d+$/.test(trimmed) ? trimmed : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mods-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/mods-parser.ts apps/api/tests/mods-parser.test.ts
git feat "新增模组 setup 解析与 ID 归一化"
```

---

## Task 2: 深度切分解析 overrides 文件

**Files:**
- Modify: `apps/api/src/config/mods-parser.ts`
- Test: `apps/api/tests/mods-parser.test.ts`

- [ ] **Step 1: Write the failing test**

追加到 `apps/api/tests/mods-parser.test.ts`（在文件末尾，先补 import）：

```ts
import { parseOverrides } from "../src/config/mods-parser.js";

describe("parseOverrides", () => {
  const sample = `return {
  ["workshop-378160973"]={ enabled=true },
  ["workshop-123456"]={
    enabled=false,
    configuration_options={ ["difficulty"]="hard", ["nested"]={ a=1 } }
  }
}
`;

  it("提取每个模组的 id / enabled，并原样保留块文本", () => {
    const entries = parseOverrides(sample);
    expect(entries.map((e) => e.id)).toEqual(["378160973", "123456"]);
    expect(entries.map((e) => e.enabled)).toEqual([true, false]);
    expect(entries[1].raw).toContain('["difficulty"]="hard"');
    expect(entries[1].raw).toContain("nested");
  });

  it("空表返回空数组", () => {
    expect(parseOverrides("return {}\n")).toEqual([]);
  });

  it("根表花括号不匹配时抛 ModParseError", () => {
    expect(() => parseOverrides("return {")).toThrow(/花括号|根表/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mods-parser.test.ts -t parseOverrides`
Expected: FAIL（`parseOverrides` 未定义）

- [ ] **Step 3: Write minimal implementation**

追加到 `apps/api/src/config/mods-parser.ts`：

```ts
export interface OverrideEntry {
  id: string;
  enabled: boolean;
  raw: string;
}

const KEY_RE = /\[\s*["'](?:workshop-)?(\d+)["']\s*\]\s*=/;

// 返回根表 `{ ... }` 内部的内容（不含最外层花括号）。简单按花括号深度匹配，
// 不解析字符串内的花括号——DST 生成的配置不会出现，复杂情况由高级原文编辑兜底。
function rootTableBody(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new ModParseError("找不到 modoverrides 的根表");
  }
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start + 1, i);
      }
    }
  }
  throw new ModParseError("modoverrides 根表花括号不匹配");
}

// 按深度为 0 的逗号切分顶层条目。
function splitTopLevel(body: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      if (current.trim()) segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
}

export function parseOverrides(text: string): OverrideEntry[] {
  const body = rootTableBody(text);
  const entries: OverrideEntry[] = [];
  for (const segment of splitTopLevel(body)) {
    const keyMatch = segment.match(KEY_RE);
    if (!keyMatch) continue;
    entries.push({
      id: keyMatch[1],
      enabled: /enabled\s*=\s*true/.test(segment),
      raw: segment.trim()
    });
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mods-parser.test.ts`
Expected: PASS（含 Task 1 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/mods-parser.ts apps/api/tests/mods-parser.test.ts
git feat "新增 modoverrides 深度切分解析"
```

---

## Task 3: 增删改两个 Lua 文件（纯函数）

**Files:**
- Modify: `apps/api/src/config/mods-parser.ts`
- Test: `apps/api/tests/mods-parser.test.ts`

- [ ] **Step 1: Write the failing test**

追加到 `apps/api/tests/mods-parser.test.ts`（先补 import）：

```ts
import { addMod, removeMod, setEnabled } from "../src/config/mods-parser.js";

describe("增删改", () => {
  const files = {
    setup: 'ServerModSetup("111")\nServerModSetup("222")\n',
    overrides: `return {
  ["workshop-111"]={ enabled=true },
  ["workshop-222"]={ enabled=false, configuration_options={ ["k"]="v" } }
}
`
  };

  it("addMod 同时写入 setup 与 overrides，默认启用，幂等", () => {
    const next = addMod(files, "333");
    expect(parseSetup(next.setup)).toEqual(["111", "222", "333"]);
    const entry = parseOverrides(next.overrides).find((e) => e.id === "333");
    expect(entry?.enabled).toBe(true);
    // 幂等：再次添加不重复
    const again = addMod(next, "333");
    expect(parseSetup(again.setup)).toEqual(["111", "222", "333"]);
    expect(parseOverrides(again.overrides).filter((e) => e.id === "333")).toHaveLength(1);
  });

  it("removeMod 从两个文件移除，保留其他模组的内层配置", () => {
    const next = removeMod(files, "111");
    expect(parseSetup(next.setup)).toEqual(["222"]);
    const entries = parseOverrides(next.overrides);
    expect(entries.map((e) => e.id)).toEqual(["222"]);
    expect(next.overrides).toContain('["k"]="v"');
  });

  it("setEnabled 只翻转目标模组的 enabled，不丢配置", () => {
    const next = setEnabled(files, "222", true);
    const entry = parseOverrides(next.overrides).find((e) => e.id === "222");
    expect(entry?.enabled).toBe(true);
    expect(next.overrides).toContain('["k"]="v"');
    // 其他模组不受影响
    expect(parseOverrides(next.overrides).find((e) => e.id === "111")?.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mods-parser.test.ts -t 增删改`
Expected: FAIL（`addMod` 等未定义）

- [ ] **Step 3: Write minimal implementation**

追加到 `apps/api/src/config/mods-parser.ts`：

```ts
export interface ModFiles {
  setup: string;
  overrides: string;
}

function setupHasId(setup: string, id: string): boolean {
  return parseSetup(setup).includes(id);
}

function addSetupLine(setup: string, id: string): string {
  if (setupHasId(setup, id)) return setup;
  const line = `ServerModSetup("${id}")\n`;
  if (setup === "" || setup.endsWith("\n")) return setup + line;
  return `${setup}\n${line}`;
}

function removeSetupLine(setup: string, id: string): string {
  const kept = setup
    .split("\n")
    .filter((rawLine) => {
      const match = rawLine.match(/ServerModSetup\(\s*["'](?:workshop-)?(\d+)["']\s*\)/);
      return !(match && match[1] === id);
    });
  return kept.join("\n");
}

function serializeOverrides(entries: OverrideEntry[]): string {
  if (entries.length === 0) return "return {}\n";
  const body = entries.map((entry) => `  ${entry.raw},`).join("\n");
  return `return {\n${body}\n}\n`;
}

function buildEntryRaw(id: string, enabled: boolean): string {
  return `["workshop-${id}"]={ enabled=${enabled} }`;
}

function setEnabledInRaw(raw: string, enabled: boolean): string {
  if (/enabled\s*=\s*(true|false)/.test(raw)) {
    return raw.replace(/enabled\s*=\s*(true|false)/, `enabled=${enabled}`);
  }
  // 没有 enabled 字段时，在值表的第一个 `{` 后注入
  return raw.replace(/=\s*\{/, `={ enabled=${enabled},`);
}

export function addMod(files: ModFiles, id: string): ModFiles {
  const entries = parseOverrides(files.overrides);
  const nextEntries = entries.some((entry) => entry.id === id)
    ? entries
    : [...entries, { id, enabled: true, raw: buildEntryRaw(id, true) }];
  return {
    setup: addSetupLine(files.setup, id),
    overrides: serializeOverrides(nextEntries)
  };
}

export function removeMod(files: ModFiles, id: string): ModFiles {
  const entries = parseOverrides(files.overrides).filter((entry) => entry.id !== id);
  return {
    setup: removeSetupLine(files.setup, id),
    overrides: serializeOverrides(entries)
  };
}

export function setEnabled(files: ModFiles, id: string, enabled: boolean): ModFiles {
  const entries = parseOverrides(files.overrides).map((entry) =>
    entry.id === id
      ? { ...entry, enabled, raw: setEnabledInRaw(entry.raw, enabled) }
      : entry
  );
  return {
    setup: files.setup,
    overrides: serializeOverrides(entries)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mods-parser.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/mods-parser.ts apps/api/tests/mods-parser.test.ts
git feat "新增模组增删改纯函数"
```

---

## Task 4: Steam 名称解析与磁盘缓存

**Files:**
- Create: `apps/api/src/config/mod-names.ts`
- Test: `apps/api/tests/mod-names.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/tests/mod-names.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveModNames } from "../src/config/mod-names.js";

describe("resolveModNames", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot() {
    const root = mkdtempSync(resolve(tmpdir(), "dst-names-"));
    roots.push(root);
    return root;
  }

  function fakeFetch(titles: Record<string, string>) {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          publishedfiledetails: Object.entries(titles).map(([id, title]) => ({
            publishedfileid: id,
            title
          }))
        }
      })
    })) as unknown as typeof fetch;
  }

  it("解析名称并写入磁盘缓存", async () => {
    const root = tempRoot();
    const fetchImpl = fakeFetch({ "111": "Global Positions" });
    const names = await resolveModNames(root, ["111"], fetchImpl);
    expect(names).toEqual({ "111": "Global Positions" });
    const cache = JSON.parse(
      readFileSync(resolve(root, "data/mods/.mod-names.json"), "utf8")
    );
    expect(cache["111"]).toBe("Global Positions");
  });

  it("命中缓存时不再请求 Steam", async () => {
    const root = tempRoot();
    const first = fakeFetch({ "111": "Global Positions" });
    await resolveModNames(root, ["111"], first);
    const second = fakeFetch({ "111": "SHOULD NOT BE USED" });
    const names = await resolveModNames(root, ["111"], second);
    expect(second).not.toHaveBeenCalled();
    expect(names["111"]).toBe("Global Positions");
  });

  it("Steam 请求失败时降级为 null，不抛错", async () => {
    const root = tempRoot();
    const failing = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const names = await resolveModNames(root, ["999"], failing);
    expect(names).toEqual({ "999": null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mod-names.test.ts`
Expected: FAIL（找不到 `mod-names.js`）

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/config/mod-names.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mod-names.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/mod-names.ts apps/api/tests/mod-names.test.ts
git feat "新增 Steam 模组名称解析与缓存"
```

---

## Task 5: GET /mods/list 端点

**Files:**
- Modify: `apps/api/src/config/routes.ts`
- Test: `apps/api/tests/mod-files.test.ts`

- [ ] **Step 1: Write the failing test**

在 `apps/api/tests/mod-files.test.ts` 顶部把名称解析 mock 掉（放在 import 之后、`describe` 之前），并追加一个 `describe`：

```ts
import { vi } from "vitest";

vi.mock("../src/config/mod-names.js", () => ({
  resolveModNames: vi.fn(async (_root: string, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, `name-${id}`]))
  )
}));
```

```ts
describe("结构化模组列表", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });

  function seededRoot() {
    const root = mkdtempSync(resolve(tmpdir(), "dst-mods-list-"));
    tempRoots.push(root);
    return root;
  }

  it("GET /mods/list 合并 setup、overrides 与名称", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("111")\nServerModSetup("222")\n',
      overrides:
        'return {\n  ["workshop-111"]={ enabled=true },\n  ["workshop-222"]={ enabled=false }\n}\n'
    });

    const res = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { id: "111", name: "name-111", enabled: true, inSetup: true, configRaw: '["workshop-111"]={ enabled=true }' },
        { id: "222", name: "name-222", enabled: false, inSetup: true, configRaw: '["workshop-222"]={ enabled=false }' }
      ]
    });
  });
});
```

> 注意：`afterEach` 在该文件可能已存在于其它 describe 内；本 describe 自带独立的 `tempRoots`，互不影响。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mod-files.test.ts -t "结构化模组列表"`
Expected: FAIL（404 或路由不存在）

- [ ] **Step 3: Write minimal implementation**

修改 `apps/api/src/config/routes.ts`：顶部追加 import，并在 `return router;` 之前插入端点。

import 区追加：

```ts
import { addMod, ModParseError, normalizeModId, parseOverrides, parseSetup, removeMod, setEnabled } from "./mods-parser.js";
import { resolveModNames } from "./mod-names.js";
```

在 `router.put("/mods", ...)` 之后、`return router;` 之前插入：

```ts
  router.get("/mods/list", async (_request, response, next) => {
    try {
      const files = await readModFiles(projectRoot);
      const setupIds = parseSetup(files.setup);
      const overrides = parseOverrides(files.overrides);
      const ids = Array.from(new Set([...setupIds, ...overrides.map((entry) => entry.id)]));
      const names = await resolveModNames(projectRoot, ids);

      const items = ids.map((id) => {
        const entry = overrides.find((candidate) => candidate.id === id);
        return {
          id,
          name: names[id] ?? null,
          enabled: entry?.enabled ?? false,
          inSetup: setupIds.includes(id),
          configRaw: entry?.raw ?? ""
        };
      });

      response.json({ items });
    } catch (error) {
      if (error instanceof ModParseError) {
        response.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mod-files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/routes.ts apps/api/tests/mod-files.test.ts
git feat "新增模组结构化列表接口"
```

---

## Task 6: POST / DELETE / PATCH 模组端点

**Files:**
- Modify: `apps/api/src/config/routes.ts`
- Test: `apps/api/tests/mod-files.test.ts`

- [ ] **Step 1: Write the failing test**

在「结构化模组列表」describe 内追加：

```ts
  it("POST /mods 新增模组到两个文件", async () => {
    const root = seededRoot();
    await writeModFiles(root, { setup: "", overrides: "return {}\n" });

    const post = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods",
      "POST",
      { id: "555" }
    );
    expect(post.status).toBe(200);

    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["555"]);
  });

  it("POST /mods 非法 ID 返回 400", async () => {
    const root = seededRoot();
    await writeModFiles(root, { setup: "", overrides: "return {}\n" });
    const post = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods",
      "POST",
      { id: "abc" }
    );
    expect(post.status).toBe(400);
  });

  it("DELETE /mods/:id 移除模组", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("111")\n',
      overrides: 'return {\n  ["workshop-111"]={ enabled=true }\n}\n'
    });
    const del = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/111",
      "DELETE"
    );
    expect(del.status).toBe(200);
    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect((list.body as { items: unknown[] }).items).toEqual([]);
  });

  it("DELETE /mods/:id 不存在返回 404", async () => {
    const root = seededRoot();
    await writeModFiles(root, { setup: "", overrides: "return {}\n" });
    const del = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/777",
      "DELETE"
    );
    expect(del.status).toBe(404);
  });

  it("PATCH /mods/:id 翻转 enabled", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("111")\n',
      overrides: 'return {\n  ["workshop-111"]={ enabled=true }\n}\n'
    });
    const patch = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/111",
      "PATCH",
      { enabled: false }
    );
    expect(patch.status).toBe(200);
    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect((list.body as { items: { enabled: boolean }[] }).items[0].enabled).toBe(false);
  });
```

> `requestConfigRouter` 已支持任意 method 与 body，无需改动。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mod-files.test.ts -t "结构化模组列表"`
Expected: FAIL（端点不存在）

- [ ] **Step 3: Write minimal implementation**

在 `routes.ts` 的 `GET /mods/list` 之后插入：

```ts
  router.post("/mods", async (request, response, next) => {
    try {
      const id = normalizeModId(request.body?.id);
      if (!id) {
        response.status(400).json({ error: "缺少有效的模组 ID" });
        return;
      }
      const files = await readModFiles(projectRoot);
      await writeModFiles(projectRoot, addMod(files, id));
      response.json({ ok: true });
    } catch (error) {
      if (error instanceof ModParseError) {
        response.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.delete("/mods/:id", async (request, response, next) => {
    try {
      const id = normalizeModId(request.params.id);
      if (!id) {
        response.status(400).json({ error: "无效的模组 ID" });
        return;
      }
      const files = await readModFiles(projectRoot);
      const known =
        parseSetup(files.setup).includes(id) ||
        parseOverrides(files.overrides).some((entry) => entry.id === id);
      if (!known) {
        response.status(404).json({ error: "模组不存在" });
        return;
      }
      await writeModFiles(projectRoot, removeMod(files, id));
      response.json({ ok: true });
    } catch (error) {
      if (error instanceof ModParseError) {
        response.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.patch("/mods/:id", async (request, response, next) => {
    try {
      const id = normalizeModId(request.params.id);
      if (!id) {
        response.status(400).json({ error: "无效的模组 ID" });
        return;
      }
      const files = await readModFiles(projectRoot);
      const known = parseOverrides(files.overrides).some((entry) => entry.id === id);
      if (!known) {
        response.status(404).json({ error: "模组不存在" });
        return;
      }
      const enabled = request.body?.enabled !== false;
      await writeModFiles(projectRoot, setEnabled(files, id, enabled));
      response.json({ ok: true });
    } catch (error) {
      if (error instanceof ModParseError) {
        response.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/api exec vitest run tests/mod-files.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查与提交**

Run: `pnpm --filter @dst-admin/api lint`
Expected: 无错误

```bash
git add apps/api/src/config/routes.ts apps/api/tests/mod-files.test.ts
git feat "新增模组增删与启用切换接口"
```

---

## Task 7: 前端 API client

**Files:**
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: 追加类型与请求函数**

在 `apps/web/src/api/client.ts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @dst-admin/web lint`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/client.ts
git feat "前端新增模组列表 API 客户端"
```

---

## Task 8: ModsConfigPanel 列表 + 高级折叠区

**Files:**
- Modify: `apps/web/src/components/ModsConfigPanel.vue`

- [ ] **Step 1: 重写组件**

把 `apps/web/src/components/ModsConfigPanel.vue` 整体替换为：

```vue
<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>模组配置</span>
        <span class="section-subtitle">列表管理，复杂配置可用高级原文编辑</span>
      </div>
    </template>

    <div class="add-row">
      <n-input
        v-model:value="newId"
        placeholder="输入 Workshop ID，如 378160973"
        @keyup.enter="onAdd"
      />
      <n-button type="primary" :loading="adding" @click="onAdd">添加</n-button>
    </div>

    <n-spin :show="loading">
      <n-empty v-if="items.length === 0" description="暂无模组" class="empty" />
      <n-list v-else bordered>
        <n-list-item v-for="item in items" :key="item.id">
          <div class="mod-row">
            <div class="mod-info">
              <span class="mod-name">{{ item.name ?? `模组 ${item.id}` }}</span>
              <a
                class="mod-id"
                :href="`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`"
                target="_blank"
                rel="noreferrer"
                >{{ item.id }}</a
              >
            </div>
            <div class="mod-actions">
              <n-switch
                :value="item.enabled"
                :loading="busyId === item.id"
                @update:value="(value: boolean) => onToggle(item, value)"
              />
              <n-button quaternary size="small" @click="openConfig(item)">查看配置</n-button>
              <n-popconfirm @positive-click="onRemove(item)">
                <template #trigger>
                  <n-button quaternary type="error" size="small" :data-testid="`remove-${item.id}`">
                    删除
                  </n-button>
                </template>
                确认删除该模组？
              </n-popconfirm>
            </div>
          </div>
        </n-list-item>
      </n-list>
    </n-spin>

    <n-collapse class="advanced">
      <n-collapse-item title="高级 · 原文编辑" name="raw">
        <n-tabs type="line" animated>
          <n-tab-pane name="setup" tab="dedicated_server_mods_setup.lua">
            <n-input v-model:value="draft.setup" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" />
          </n-tab-pane>
          <n-tab-pane name="overrides" tab="modoverrides.lua">
            <n-input v-model:value="draft.overrides" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" />
          </n-tab-pane>
        </n-tabs>
        <n-button type="primary" :loading="saving" @click="emitSave">保存模组配置</n-button>
      </n-collapse-item>
    </n-collapse>

    <n-modal v-model:show="configVisible" preset="card" style="max-width: 640px" title="模组配置">
      <n-input :value="configText" type="textarea" readonly :autosize="{ minRows: 6, maxRows: 20 }" />
    </n-modal>
  </n-card>
</template>

<script setup lang="ts">
import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NList,
  NListItem,
  NModal,
  NPopconfirm,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  useMessage
} from "naive-ui";
import { onMounted, reactive, ref, watch } from "vue";

import {
  addMod as apiAddMod,
  getModList,
  removeMod as apiRemoveMod,
  setModEnabled,
  type ModListItem,
  type ModsConfig
} from "../api/client";

const props = defineProps<{
  modelValue: ModsConfig;
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [ModsConfig];
  save: [];
}>();

const message = useMessage();
const draft = reactive({ ...props.modelValue });
const items = ref<ModListItem[]>([]);
const loading = ref(false);
const adding = ref(false);
const busyId = ref<string | null>(null);
const newId = ref("");
const configVisible = ref(false);
const configText = ref("");

watch(
  () => props.modelValue,
  (value) => Object.assign(draft, value),
  { deep: true }
);

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

async function refresh() {
  loading.value = true;
  try {
    items.value = (await getModList()).items;
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    loading.value = false;
  }
}

async function onAdd() {
  const id = newId.value.trim();
  if (!id) return;
  adding.value = true;
  try {
    await apiAddMod(id);
    newId.value = "";
    await refresh();
    message.success("已添加模组");
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    adding.value = false;
  }
}

async function onToggle(item: ModListItem, value: boolean) {
  busyId.value = item.id;
  try {
    await setModEnabled(item.id, value);
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    busyId.value = null;
  }
}

async function onRemove(item: ModListItem) {
  try {
    await apiRemoveMod(item.id);
    await refresh();
    message.success("已删除模组");
  } catch (error) {
    message.error(asMessage(error));
  }
}

function openConfig(item: ModListItem) {
  configText.value = item.configRaw || "（该模组没有覆盖配置）";
  configVisible.value = true;
}

function emitSave() {
  emit("update:modelValue", { ...draft });
  emit("save");
}

onMounted(refresh);
</script>

<style scoped>
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.mod-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.mod-info {
  display: flex;
  flex-direction: column;
}
.mod-name {
  font-weight: 600;
}
.mod-id {
  font-size: 12px;
  opacity: 0.7;
}
.mod-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.advanced {
  margin-top: 16px;
}
.empty {
  padding: 24px 0;
}
</style>
```

> 父组件 `AppShell.vue` 仍传 `modelValue` 与 `saving`、监听 `save`/`update:modelValue`，无需改动；列表数据由本组件自行加载。保存原文后如需同步列表，用户切换面板或刷新页面即可（`onMounted` 重新拉取）。

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @dst-admin/web lint`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ModsConfigPanel.vue
git feat "模组配置面板改为列表加高级原文编辑"
```

---

## Task 9: ModsConfigPanel 组件测试

**Files:**
- Create: `apps/web/src/components/ModsConfigPanel.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/ModsConfigPanel.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  getModList: vi.fn(async () => ({
    items: [
      { id: "111", name: "Global Positions", enabled: true, inSetup: true, configRaw: "raw-111" }
    ]
  })),
  addMod: vi.fn(async () => undefined),
  removeMod: vi.fn(async () => undefined),
  setModEnabled: vi.fn(async () => undefined)
}));

import * as client from "../api/client";
import ModsConfigPanel from "./ModsConfigPanel.vue";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ModsConfigPanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("挂载后渲染模组列表", async () => {
    const wrapper = mount(ModsConfigPanel, {
      props: { modelValue: { setup: "", overrides: "" }, saving: false }
    });
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Global Positions");
    expect(wrapper.text()).toContain("111");
  });

  it("点击删除调用 removeMod", async () => {
    const wrapper = mount(ModsConfigPanel, {
      attachTo: document.body,
      props: { modelValue: { setup: "", overrides: "" }, saving: false }
    });
    await flush();
    await wrapper.vm.$nextTick();

    const removeButton = wrapper.get('[data-testid="remove-111"]');
    await removeButton.trigger("click");
    const confirm = document.body.querySelector(
      ".n-popconfirm__action .n-button--primary-type"
    ) as HTMLButtonElement | null;
    confirm?.click();
    await flush();

    expect(client.removeMod).toHaveBeenCalledWith("111");
  });
});
```

> 第二个用例依赖 Naive UI Popconfirm 渲染到 `document.body`；若确认按钮选择器不稳定，可改为直接断言列表渲染（第一个用例）为必过项，删除用例作为加强项。运行时以实际 DOM 为准微调选择器。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dst-admin/web exec vitest run src/components/ModsConfigPanel.test.ts`
Expected: FAIL（实现尚未被测或选择器需校准；先确认第一个用例可过）

- [ ] **Step 3: 按实际 DOM 校准选择器后使其通过**

若 Popconfirm 确认按钮选择器不匹配，用 `wrapper.html()` / `document.body.innerHTML` 打印实际结构调整。第一个用例必须通过。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @dst-admin/web exec vitest run src/components/ModsConfigPanel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ModsConfigPanel.test.ts
git test "新增模组配置面板组件测试"
```

---

## Task 10: 全量验证

- [ ] **Step 1: 跑全部测试**

Run: `pnpm test`
Expected: 所有包测试通过

- [ ] **Step 2: 类型检查**

Run: `pnpm lint`
Expected: api（tsc）与 web（vue-tsc）均无错误

- [ ] **Step 3: 手动冒烟（可选）**

Run: `pnpm dev`，浏览器打开 web，进入「模组配置」：
- 填一个真实 Workshop ID 添加，看到名称解析（容器/本机需可访问 Steam）。
- 切换开关、查看配置弹窗、删除。
- 展开「高级 · 原文编辑」确认两个 Lua 文本框仍可保存。

- [ ] **Step 4: 若有未提交改动则提交**

```bash
git status --short
```

---

## 自检对照

- 删除模组 → Task 3 `removeMod` + Task 6 DELETE + Task 8 UI ✅
- 启用/禁用 → Task 3 `setEnabled` + Task 6 PATCH + Task 8 NSwitch ✅
- 查看配置 → Task 5 `configRaw` + Task 8 NModal ✅
- 新增模组（ID） → Task 3 `addMod` + Task 6 POST + Task 8 添加行 ✅
- Steam 名称自动解析 + 缓存 + 降级 → Task 4 ✅
- 保留原文编辑兜底 → Task 8 高级折叠区 + 保留 `GET/PUT /mods` ✅
- 内层配置不丢失 → Task 2/3 深度切分 + raw 块保留，单测断言 ✅
