# 存档备份/恢复 + 就绪检测优化 — 设计

日期：2026-06-05
状态：已确认，待编写实现计划

## 背景

DST 后台目前能启停服务器、改世界/模组配置、看日志，但缺两样东西：

1. **存档备份/恢复**——管理员刚需，没有一键手段把世界存档拿下来或回滚。
2. **就绪检测开销**——`getServerStatus()` 在 `overall === "running"` 时每次轮询都 `docker compose logs --tail 1000` 扫就绪标记，服务器已稳定运行时纯属浪费，且前端总览页还会另外拉 200 行日志，等于每个 8s tick 至少跑两次 `docker compose logs`。

两块互相独立，可分别实现与测试，但放在一个迭代里交付。

## 关键数据位置（已核对 compose 与 render-config.sh）

- 世界存档实际落在宿主机 `data/cluster/DoNotStarveTogether/Cluster/`，通过 volume 挂到两个 DST 容器的 `/var/lib/dst/cluster`。
- 该目录内容：`Master/`、`Caves/`（各含 `save/`、`server.ini`、`modoverrides.lua`）、`cluster.ini`、以及 **`cluster_token.txt`（Steam 密钥）**。
- `data/cluster/admin/server-config.json` 是后台写的世界配置，**不在本次备份范围内**。
- admin-api 容器挂载了 `./data:/app/data`，对上述目录有直接读写权限，因此备份/恢复是**纯文件操作，无需 `docker exec`**。

---

## 组件一：存档备份/恢复

### 范围决策

- 备份内容：仅 `DoNotStarveTogether/Cluster/` 下的世界存档与 `cluster.ini`，**排除 `cluster_token.txt`**（避免明文 Steam 密钥进入备份包，可跨机器恢复）。
- 恢复安全：**要求服务器已停止**，否则拒绝；不做「偿偿」自动停服。
- 管理能力：列表 + 创建 + 恢复 + 删除 + 下载（完整闭环）。

### 后端

新增目录 `apps/api/src/backup/`：

**`service.ts`**

常量：
- `SAVE_DIR = <projectRoot>/data/cluster/DoNotStarveTogether/Cluster`
- `BACKUP_DIR = <projectRoot>/data/backups`
- `TOKEN_FILENAME = "cluster_token.txt"`
- 文件名白名单正则：`/^[\w.-]+\.tar\.gz$/`

函数：

- `listBackups(projectRoot): Promise<BackupEntry[]>`
  - 读取 `BACKUP_DIR` 下所有 `*.tar.gz`，对每个 `stat` 取 `size` 与 `mtime`。
  - 返回 `{ name, createdAt /* ISO string */, size /* bytes */ }[]`，按 `createdAt` 倒序。
  - 目录不存在时返回 `[]`（不报错）。

- `createBackup(projectRoot, label?): Promise<BackupEntry>`
  - 生成文件名 `dst-save-YYYYMMDD-HHmmss[-<label>].tar.gz`；`label` 经 slug 化（仅保留 `[\w-]`，截断长度），为空则省略该段。
  - 确保 `BACKUP_DIR` 存在（`mkdir -p`）。
  - 用 npm `tar` 包以 `SAVE_DIR` 为 cwd 打包其全部内容，**通过 `filter` 排除 `cluster_token.txt`**。
  - `SAVE_DIR` 不存在或为空时抛出明确错误（「暂无可备份的存档」）。
  - 返回新建条目。

- `restoreBackup(projectRoot, name): Promise<void>`
  - 校验 `name`（正则 + 解析路径必须落在 `BACKUP_DIR` 内），不存在则抛 404 语义错误。
  - **校验服务器已停**：调用 `parseComposeStatus(runCompose("status", projectRoot))`，若 `overall !== "stopped"` 抛带 409 语义的错误（「请先停止服务器再恢复」）。这里只看容器状态，**不读日志**。
  - 恢复流程（保证世界完整替换且不丢 token）：
    1. 读取现有 `SAVE_DIR/cluster_token.txt`（若存在）内容到内存。
    2. 解压归档到临时目录 `BACKUP_DIR/.restore-tmp-<rand>`（`tar` 解压自带防穿越）。
    3. 校验解压结果非空（至少含 `cluster.ini` 或一个 shard 目录），否则视为损坏归档报错并清理临时目录。
    4. 删除 `SAVE_DIR` 下**除 `cluster_token.txt` 外**的全部内容。
    5. 把临时目录内容移动到 `SAVE_DIR`。
    6. 若步骤 1 读到过 token 而恢复后 `SAVE_DIR` 缺失该文件，则写回。
    7. 清理临时目录。

- `deleteBackup(projectRoot, name): Promise<void>`
  - 校验 `name`，`unlink`；不存在抛 404 语义错误。

- `resolveBackupPath(projectRoot, name): string`
  - 校验 `name` 后返回绝对路径，供下载路由 `sendFile` 使用；非法名抛错。

类型：

```ts
export interface BackupEntry {
  name: string;       // dst-save-20260605-141500.tar.gz
  createdAt: string;  // ISO
  size: number;       // bytes
}
```

**`routes.ts`** — `createBackupRouter(projectRoot)` 挂到 `/api/backups`：

- `GET /` → `{ items: BackupEntry[] }`
- `POST /` → body 可选 `{ label?: string }`，返回新建 `BackupEntry`
- `POST /:name/restore` → `{ ok: true }`；服务器未停返回 `409 { error }`；归档不存在返回 `404 { error }`
- `DELETE /:name` → `{ ok: true }`；不存在返回 `404`
- `GET /:name/download` → `res.download(resolveBackupPath(...))`；非法名返回 `400`，不存在 `404`
- 校验失败统一返回对应状态码 + `{ error: 中文消息 }`；其余错误交给全局 error handler。

在 `apps/api/src/index.ts` `createApp()` 内挂载：`app.use("/api/backups", createBackupRouter(projectRoot))`。

**依赖**：新增 `tar`（npm 包）到 `apps/api` dependencies，以及 `@types/tar`（如类型不内置）到 devDependencies。选 npm `tar` 而非 shell `tar` 的理由：纯 JS、可在 vitest 直接测试、解压自带防目录穿越过滤、不依赖 API 镜像里是否安装了 tar。

### 前端

- `apps/web/src/api/client.ts` 新增：
  - `interface BackupEntry { name: string; createdAt: string; size: number }`
  - `listBackups(): Promise<{ items: BackupEntry[] }>`
  - `createBackup(label?: string): Promise<BackupEntry>`
  - `restoreBackup(name: string): Promise<void>`
  - `deleteBackup(name: string): Promise<void>`
  - 下载用 `window.open('/api/backups/' + encodeURIComponent(name) + '/download')`（basic auth 凭据由浏览器自动携带）。
- 新增组件 `apps/web/src/components/BackupPanel.vue`：
  - 顶部：可选备注输入 + 「立即备份」按钮（loading 态）。
  - 列表（`n-list` 或 `n-data-table`）：名称、创建时间（本地化）、大小（人类可读）。
  - 每行操作：恢复（`n-popconfirm`，文案提示需先停服）/ 删除（`n-popconfirm`）/ 下载。
  - 恢复请求遇 409 → `message.error("请先停止服务器再恢复")`；其余错误显示后端消息。
  - 空列表显示 `n-empty`。
- `apps/web/src/components/AppShell.vue`：
  - `SectionKey` 增加 `"backup"`。
  - `menuOptions` 增加「存档备份」项（lucide 图标，如 `Archive` 或 `DatabaseBackup`）。
  - `heroMeta` 增加对应标题/文案。
  - 在内容区按 `activeSection === "backup"` 渲染 `<BackupPanel />`。

### 测试

- `apps/api/tests/backup-service.test.ts`（vitest node 环境，用临时目录）：
  - 创建备份后 `cluster_token.txt` 不在归档内、世界文件在内。
  - `listBackups` 排序与字段正确；目录不存在返回 `[]`。
  - 恢复在「服务器未停」时抛 409 语义错误（mock `runCompose` 返回运行中状态）。
  - 恢复保留既有 `cluster_token.txt`、完整替换世界内容（旧存档独有文件被清掉）。
  - `name` 含 `../` 等非法字符时 restore/delete/resolvePath 抛错。
- `apps/api/tests/backup-routes.test.ts`：用 supertest 风格或直接调 `createApp()` 验证各状态码（200/400/404/409）。
- `apps/web/src/components/BackupPanel.test.ts`（jsdom）：渲染列表、点击「立即备份」触发 API、恢复 popconfirm 行为（mock client）。

---

## 组件二：就绪检测优化

### 现状

`apps/api/src/server/service.ts` 的 `getServerStatus()`：`overall === "running"` 时无条件 `runCompose("logs", projectRoot, "1000")` 扫就绪标记。稳态下每 8s 重复扫描，且与前端总览页的 200 行日志拉取叠加。

### 方案：就绪态 latch（模块级内存缓存）

在 `service.ts` 内维护一个布尔 latch：

```
let readyLatched = false;
```

`getServerStatus(projectRoot)` 改为：
1. `status = parseComposeStatus(runCompose("status"))`
2. 若 `status.overall !== "running"`：`readyLatched = false`，返回 `status`。
3. 若 `status.overall === "running"`：
   - 若 `readyLatched` 为 true：直接返回 `status`（**跳过日志扫描**）。
   - 否则：扫一次 `logs(1000)`，`isServerReady(...)` 为真 → `readyLatched = true`，返回 `status`；为假 → 返回 `{ ...status, overall: "starting" }`（latch 保持 false）。

`runServerAction(projectRoot, action)`（start/stop/restart 都经此）执行后将 `readyLatched = false`，确保用户主动操作后强制重新判定。

为可测试性：导出一个仅供测试的 `__resetReadyLatch()`（或将 latch 封进一个由工厂返回的对象）。倾向保留现有自由函数签名 + 暴露测试用重置钩子，避免改动调用点。

`--tail 1000` 保持不变（不降低），以免漏掉 start marker 造成「启动中却误报 running」的回归。

### 效果与盲区

- 稳态（服务器已就绪、持续运行）下完全不再拉 1000 行日志。
- 崩溃后被 docker 自动重启：中途会出现 `overall !== "running"`（容器退出）从而清掉 latch，重启回来后重新扫描，正确显示「启动中」。
- 唯一理论盲区：DST 在两次 8s 轮询间完成整轮世界重载（容器退出→重启→加载完成全发生在 8s 内）。DST 世界加载以分钟计，实际不可能发生。

### 测试

- `apps/api/tests/status-service.test.ts`（vitest，`vi.mock` `../docker/compose.js` 的 `runCompose`）：
  - 首次 `running` 且日志含就绪标记 → 返回 running，且 logs runner 被调用一次。
  - 紧接的第二次 `running` 调用 → 返回 running，且 logs runner **未再被调用**（验证 latch）。
  - 中间出现 `stopped` → latch 失效；再次 `running` 时 logs runner 重新被调用。
  - `running` 但日志无就绪标记 → 返回 `starting`，latch 不置位。
  - `runServerAction` 后 latch 被清除。
  - 每个用例前 `__resetReadyLatch()`。

---

## 交付边界（YAGNI）

本次明确**不包含**：定时自动备份、备份保留策略/自动清理、上传外部归档恢复、增量备份、备份加密。这些归入下方 Backlog。

---

## 后续优化与扩展 Backlog

以下为对当前代码库整体调研后识别出的候选项，**不属于本次迭代**，记录于此供后续按价值排期。每项标注相对价值（⭐ 越多越高）与简述。

### A. 可优化项（现有功能改进）

1. **日志全量重拉、无流式** ⭐⭐
   前端每 8s 整段替换日志文本，长日志浪费带宽且滚动跳动。可上 SSE（`docker compose logs -f`）或用 `--since` 做增量追加。

2. **后端动作无并发锁** ⭐⭐
   前端有 `busyAction` 防连点，但 `runServerAction`（`server/service.ts`）本身无互斥。多标签页/多人同时触发 start+restart 会并发跑 compose。建议 API 侧加进行中标志或串行队列。

3. **API 层零鉴权，纯靠 nginx basic auth** ⭐⭐
   `createApp()` 无任何 auth 中间件，安全完全依赖 nginx（`web.nginx.conf`）。compose 当前仅将 3000 端口绑定到 `127.0.0.1`（见 `docker-compose.yml`），暂时安全；若未来直接发布该端口即裸奔。建议加一层 token 中间件做纵深防御。

4. **错误统一 500 + message 明文回传** ⭐
   `index.ts` 全局 handler 直接回传 `error.message`，可能泄漏内部路径。可按需收敛为通用消息 + 服务端日志。

### B. 可扩展功能（按对 DST 管理员价值排序）

1. **控制台命令 / 公告（RCON-like）** ⭐⭐⭐
   向服务器发管理指令：`c_announce("...")` 公告、`c_save()`、`c_rollback(n)` 回档、`c_regenerateworld()` 重置世界、踢人/封禁。通过容器 stdin 注入，需打通 stdin 通道。价值最高、工程量与风险也最大，适合作为独立专题。

2. **在线玩家列表** ⭐⭐
   解析日志的玩家 join/leave，或用控制台 `c_listallplayers()` 展示当前在线。

3. **手动「更新游戏 / 检查 buildid」按钮** ⭐⭐
   后端启动时已支持按 buildid 增量更新（commit 18af51b），把它做成 UI 一键操作。

4. **容器资源监控** ⭐
   `docker stats` 展示两个分片容器的 CPU/内存。

5. **主世界/洞穴日志分 tab** ⭐
   当前 master+caves 日志合并，分开展示更易排障。

6. **定时任务** ⭐
   定时自动重启 / 定时备份（与本次备份功能天然衔接）。

7. **世界生成参数（worldgenoverride）** ⭐
   当前仅基础配置，扩展季节长度、资源、世界预设等。

### C. 本次备份功能的后续增强

承接组件一，可后续补：定时自动备份、备份保留策略与自动清理、上传外部归档恢复、增量备份、备份加密。
