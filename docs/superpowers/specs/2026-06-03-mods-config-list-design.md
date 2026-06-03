# 模组配置优化：结构化模组列表

- 日期：2026-06-03
- 状态：已确认，待实现
- 范围：单个实现计划

## 背景

Steam 版《饥荒联机版》管理后台目前的「模组配置」面板，只是把两个 Lua 文件
（`data/mods/dedicated_server_mods_setup.lua` 与 `data/mods/modoverrides.lua`）
原样塞进两个文本框直接编辑：

- `dedicated_server_mods_setup.lua`：`ServerModSetup("123")` 每行一个，决定下载哪些模组。
- `modoverrides.lua`：`return { ["workshop-123"] = { enabled = true, configuration_options = {...} } }`，
  决定哪些启用以及各自的配置。

用户无法直观看到「装了哪些模组、叫什么名字、是否启用」，也不能逐个删除/开关。

## 目标

在保留原文编辑能力的前提下，新增一个**结构化模组列表**，支持：

1. 删除模组（同时从两个文件移除）。
2. 启用/禁用开关（翻转 `modoverrides` 里的 `enabled`，不删除）。
3. 查看配置（只读预览该模组的 `configuration_options` 原文 + 名称 + ID + Workshop 链接）。
4. 新增模组（填 Workshop ID，写入两文件，默认启用，并拉取名称展示）。

模组名称由 API 服务端调用 Steam Workshop 官方接口，用 ID 自动解析。

## 非目标（YAGNI）

- 不做 `configuration_options` 的可视化表单编辑（每个模组结构不同，成本过高）；
  复杂配置仍通过「高级 · 原文编辑」直接改 Lua。
- 不做模组搜索/浏览 Workshop。
- 不引入真正的 Lua 解析器依赖。

## 技术选型：Lua 解析/写入策略

采用**轻量深度切分解析器**（纯字符串处理，零依赖）：

- 不解析内层 `configuration_options`，只按 `{}` 嵌套深度，把 `modoverrides` 顶层的
  每个 `["workshop-ID"] = <值块>` 切成「原始字符串块」。
- 读列表：从每个块里取 `id` 与 `enabled`，块原文作为配置预览。
- 删除：丢弃整块。
- 开关：仅在该块内正则翻转 `enabled = true/false`。
- 新增：追加一个新块。

如此**内层配置原样保留、绝不丢失**。DST 生成的格式很规整，加之有「高级原文编辑」兜底，
该策略足够稳健。

被否决的备选：

- 引入 `luaparse` + 重新序列化：最严谨，但写回会丢注释/格式，且新增依赖。
- 纯正则全文匹配：最简单，但嵌套花括号场景下易误匹配。

## 架构

沿用现有三层结构与项目约定（API 为 ESM，相对 import 带 `.js`；纯函数 + 路由分离便于单测）。

### 后端 `apps/api/src/config/`

**`mods-parser.ts`** — 纯函数，无 IO：

- `parseSetup(text: string): string[]` — 用正则 `ServerModSetup("123")` 提取 ID 列表。
- `parseOverrides(text: string): { id: string; enabled: boolean; raw: string }[]` — 深度切分。
- `addMod(files, id)`、`removeMod(files, id)`、`setEnabled(files, id, enabled)` —
  接收 `{ setup, overrides }` 两文件文本，返回改写后的 `{ setup, overrides }`。
- 解析失败时抛出可识别的错误（供路由转成「无法解析，请用高级原文编辑」提示）。

**`mod-names.ts`** — `resolveModNames(ids: string[]): Promise<Record<string, string | null>>`：

- 调 Steam `POST https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`
  （表单 `itemcount=N&publishedfileids[0]=...`，**无需 API key**），取 `title`。
- 内存缓存 + 磁盘缓存 `data/mods/.mod-names.json`。
- 请求失败/超时：对应 ID 返回 `null`（前端降级显示 ID），不抛错。

**`mod-files.ts`** — 复用现有 `readModFiles`/`writeModFiles`。

**`routes.ts`** — 新增端点，**保留**现有 `GET/PUT /mods`（原文编辑）。

### 新增 API 端点（挂在 `/api/config` 下）

| 方法   | 路径               | 作用 |
|--------|--------------------|------|
| GET    | `/mods/list`       | 合并 setup + overrides + 名称 → 结构化列表 |
| POST   | `/mods` `{id}`     | 新增（写两文件，默认 enabled），幂等 |
| DELETE | `/mods/:id`        | 从两文件删除，不存在返回 404 |
| PATCH  | `/mods/:id` `{enabled}` | 翻转 enabled，不存在返回 404 |

列表项结构：`{ id: string; name: string | null; enabled: boolean; inSetup: boolean; configRaw: string }`。

### 前端 `apps/web`

**`api/client.ts`** — 新增类型与函数：

- `interface ModListItem { id; name; enabled; inSetup; configRaw }`
- `getModList()`、`addMod(id)`、`removeMod(id)`、`setModEnabled(id, enabled)`
- 保留现有 `getModsConfig`/`saveModsConfig`（原文编辑）。

**`components/ModsConfigPanel.vue`** — 改为：

- 顶部：输入 Workshop ID + 「添加」按钮。
- 中部：**模组列表**（`NList` 或 `NDataTable`），每行：
  - 名称（取不到名称时显示 ID）+ ID（`NA`/链接到 `https://steamcommunity.com/sharedfiles/filedetails/?id=<id>`）。
  - `NSwitch` 启用/禁用开关。
  - 「查看配置」按钮 → `NModal` 只读展示 `configRaw`。
  - 删除按钮 + `NPopconfirm` 确认。
- 底部：`NCollapse`「高级 · 原文编辑」——保留现有两个 Lua 文本框 + 保存按钮（即现有逻辑不变）。

**`components/AppShell.vue`** — 现有 `loadMods`/`saveMods` 保留；列表所需数据与操作由
`ModsConfigPanel` 自身调用新端点，操作成功后重新拉取 `getModList()`。

## 数据流

- 列表操作（增/删/开关）→ 对应端点 → 后端 `readModFiles` → `mods-parser` 纯函数改写
  → `writeModFiles` 写回两文件 → 前端重新 `getModList()` 刷新。
- 原文编辑走旧的 `PUT /mods`，整文件覆盖。
- 两条路径都改同样的两个文件，DST 容器启动时 `render-config.sh` 照常拷贝，天然一致。

## 错误处理

- Steam 请求失败/超时（如 API 容器无外网）：名称降级为 `null`→前端显示 ID，列表照常可用，不报错刷屏。
- 删除/开关不存在的 ID：返回 404。
- 新增已存在的 ID：幂等，不重复写入。
- 解析失败（手改成异常格式）：列表接口返回可识别错误，前端提示「无法解析，请用高级原文编辑」。

## 测试

- `apps/api/tests/mods-parser.test.ts`（重点，纯函数）：
  - `parseSetup`/`parseOverrides` 对标准格式与带复杂 `configuration_options` 的样例。
  - `addMod`/`removeMod`/`setEnabled` 断言**内层配置不丢失**、setup 与 overrides 同步。
- 扩展 `apps/api/tests/mod-files.test.ts`：新端点增删改查（mock 掉 `fetch`/名称解析）。
- 前端 `apps/web/src/components/ModsConfigPanel.test.ts`（jsdom）：渲染列表、触发增删/开关事件、查看配置弹窗。

## 兼容性

- 保留 `GET/PUT /api/config/mods` 与现有原文编辑 UI，老行为不破坏。
- 不改 `render-config.sh` 与 DST 容器侧逻辑（仍读同样两个文件）。
