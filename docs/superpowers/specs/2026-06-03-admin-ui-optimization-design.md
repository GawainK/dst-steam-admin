# 后台 UI 优化设计

## Goal

优化 DST Steam Admin 后台的前端体验，解决两个核心问题：

1. **导航/信息架构**：当前侧边菜单点击并不真正切换页面，状态、控制、日志、配置全部堆在一页长滚动，菜单仅控制底部说明文档的内容。
2. **视觉风格**：原设计的毛玻璃风格在线上未生效（卡片显示为白底不透明），毛玻璃质感缺失。

本次只动 `apps/web` 前端，不改后端 API、Docker 与 DST 容器逻辑。

## Scope

包含：

- 菜单真正切换视图：每个菜单项渲染一个独立页面，内容区只挂载当前页。
- 总览页改为仪表盘：聚合状态卡 + 启停控制 + 日志摘要。
- Hero 标题区随当前页变化。
- 修复毛玻璃：配置 Naive UI 暗色主题与 themeOverrides，使卡片背景半透明、毛玻璃生效。
- 视觉改为「篝火暖橙」配色方向。
- 更新前端测试以覆盖视图切换。

不包含：

- 后端 API、命令映射、Docker、DST 容器渲染脚本的任何改动。
- 登录/权限、多集群、备份等新功能。
- 窄屏/移动端深度适配（保留现有 media query，不作为本次重点）。
- 新增网络请求或改变数据加载时机。

## 决策记录

- 导航方案：**A — 总览仪表盘 + 各功能独立成页**（菜单真正切换视图）。
- 视觉方案：**B — 篝火暖橙毛玻璃**。

## 信息架构与导航

内容区由 `activeSection` 驱动，只渲染当前页（`v-if`/switch），不再一页堆叠所有面板。

| 菜单 key   | 标题     | 页面内容 |
|-----------|----------|----------|
| `overview`| 总览     | `StatusCard`（整体 + 各容器状态）+ `ControlPanel`（启停/重启）+ 日志摘要 |
| `logs`    | 实时日志 | 完整 `LogsPanel`，保留现有手动刷新，可选自动刷新开关 |
| `config`  | 世界配置 | 整页 `ServerConfigForm` |
| `mods`    | 模组配置 | 整页 `ModsConfigPanel` |
| `docs`    | 部署说明 | 整页 `DocsPanel` |

要点：

- **日志摘要**：总览页展示现有 `logs` 数据的末尾约 20 行，旁边提供「查看全部」入口（切到 `logs` 页）。不发起额外请求，复用 `onMounted` 已拉取的日志。
- **Hero 标题区**：标题与一句说明随 `activeSection` 变化（如总览/实时日志/世界配置…），由一个 `section → {title, copy}` 的映射提供。
- **数据加载时机不变**：仍在 `onMounted` 并行拉取状态/日志/配置/模组；切页不重新请求，避免引入新行为。
- `AppShell.vue` 负责装配；各功能子组件基本复用，仅总览页新增「日志摘要」这一小块（可内联或抽成 `LogsSummary` 小组件）。

## 视觉风格（篝火暖橙毛玻璃）

### 根因修复

毛玻璃未生效的根因：`App.vue` 的 `n-config-provider` 未配置主题，Naive UI 默认**亮色主题**，`n-card` 等组件使用自带的浅色不透明背景，覆盖了 `.glass-card` 的半透明背景。

修复：

- `n-config-provider` 传入 `:theme="darkTheme"`（来自 `naive-ui`）。
- 传入 `:theme-overrides`，关键项：
  - `common`：主色/强调色改为篝火暖橙、暖白文字。
  - `Card.color`：设为半透明暖色（如 `rgba(36, 23, 16, 0.5)`），让所有卡片默认即玻璃质感；配合 CSS 的 `backdrop-filter` 实现模糊。
- 模糊效果继续由 CSS 类（`backdrop-filter: blur(...)`，含 `-webkit-` 前缀）提供。

### 配色

- **背景**：炭黑渐变 + 两处径向光晕（篝火橙、余烬红）。基调示意：
  - `radial-gradient(circle at 25% 15%, rgba(232,153,79,.5), transparent 45%)`
  - `radial-gradient(circle at 85% 85%, rgba(180,70,60,.4), transparent 42%)`
  - `linear-gradient(160deg, #241710, #160d0b 60%, #0f0a0c)`
- **玻璃卡片**：`rgba(36,23,16,.5)` 背景 + `backdrop-filter: blur(14px)` + 暖色细边框 `rgba(232,205,180,.18)`。
- **强调色**：篝火橙 `#e8994f` → 余烬红 `#c75b43` 渐变，用于品牌标记（`shell__brand-mark`）与主操作按钮。
- **正文**：暖白 `#f5e9df`，次要文字降低不透明度。
- **状态语义色保留**：运行中=绿、已停止=灰、异常=红，用 `n-tag` 语义色表达，不被暖橙强调色覆盖，保证运维可读性。
- **日志区**：保持深色高对比（沿用现有 `.log-card`），仅边框微调为余烬色调。

### 涉及文件

- `apps/web/src/App.vue`：引入 `darkTheme` 与 `themeOverrides`。
- `apps/web/src/components/AppShell.vue`：视图切换、各页装配、Hero 随页变化、总览日志摘要。
- `apps/web/src/styles.css`：篝火暖橙调色板、玻璃卡片样式。
- 各面板组件（`StatusCard`/`ControlPanel`/`LogsPanel`/`ServerConfigForm`/`ModsConfigPanel`/`DocsPanel`）：按需微调以适配整页布局，逻辑不变。

## Error Handling

- 不改变现有错误处理：API 失败仍经 `useMessage().error` 提示，`asMessage` 兜底。
- Steam token 掩码、敏感字段不回显的现有行为保持不变。

## Testing

web 测试（jsdom + vitest，源码同目录）：

- **新增**：视图切换测试——`activeSection` 切换后内容区只渲染当前页（例如选「实时日志」时日志页可见、世界配置不在 DOM）。
- **新增**：总览页日志摘要存在且「查看全部」可切到日志页。
- **保持通过**：现有 `App.test.ts`、`ControlPanel.test.ts`（启停按钮调用正确 API、停止/重启有确认）。
- 视觉/主题（themeOverrides、CSS 颜色）不做断言，靠人工在浏览器核对。

`pnpm --filter @dst-admin/web lint`（vue-tsc）需通过。

## Implementation Notes

- 仅前端改动，后端契约（`api/client.ts` 的数据结构）不变。
- 切页不触发新请求，复用首屏已加载数据。
- 保留现有 `@media (max-width: 960px)` 响应式规则，本次不深化移动端。
