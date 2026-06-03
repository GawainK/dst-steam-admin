# 后台 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后台侧边菜单真正切换视图（总览做成仪表盘，其余功能各自整页），并修复毛玻璃失效问题、改为篝火暖橙配色。

**Architecture:** 纯前端改动（`apps/web`）。`AppShell.vue` 用 `activeSection` 驱动只渲染当前页；新增 `LogsSummary.vue` 用于总览页日志摘要。毛玻璃根因是 `App.vue` 的 `n-config-provider` 未配置主题导致 Naive UI 亮色卡片盖掉半透明背景——通过 `darkTheme` + `themeOverrides`（含 `Card.color` 半透明）修复，配色与玻璃细节放在 `styles.css`。

**Tech Stack:** Vue 3 (`<script setup>`)、Naive UI、TypeScript、Vite、Vitest + @vue/test-utils（jsdom）。

---

## 文件结构

- 修改 `apps/web/src/components/AppShell.vue` — 视图切换、Hero 随页变化、总览装配。
- 新建 `apps/web/src/components/LogsSummary.vue` — 总览页日志摘要卡片（末尾 20 行 + 「查看全部」）。
- 修改 `apps/web/src/App.test.ts` — 新增视图切换测试；更新 token 测试先导航到配置页。
- 修改 `apps/web/src/App.vue` — `darkTheme` + `themeOverrides`。
- 修改 `apps/web/src/styles.css` — 篝火暖橙调色板、玻璃卡片样式。

约定提醒：Web 测试与源码同目录、jsdom 环境；`lint` 为 `vue-tsc --noEmit`。

---

### Task 1: AppShell 视图切换 + LogsSummary（TDD）

**Files:**
- Create: `apps/web/src/components/LogsSummary.vue`
- Modify: `apps/web/src/components/AppShell.vue`
- Test: `apps/web/src/App.test.ts`

- [ ] **Step 1: 写失败测试 —— 视图切换**

在 `apps/web/src/App.test.ts` 的 `describe("App", ...)` 内，`afterEach` 之后追加一个测试。它先确认总览页显示控制按钮、不含配置表单的 password 输入框，再点击「世界配置」菜单项后出现 password 输入框：

```ts
  it("switches the visible page when a menu item is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          overall: "stopped",
          containers: [],
          content: "",
          steamToken: "",
          steamTokenMasked: "",
          clusterName: "",
          clusterPassword: "",
          maxPlayers: 6,
          gameMode: "survival",
          enableCaves: true,
          masterPort: 10999,
          cavesPort: 11000,
          setup: "",
          overrides: ""
        }),
        text: async () => ""
      })
    );

    const wrapper = mount(App);
    await flushPromises();

    // 默认在总览页：有启停控制，没有配置表单的 password 输入
    expect(wrapper.text()).toContain("启动服务器");
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);

    // 切到「世界配置」
    const items = wrapper.findAll(".n-menu-item-content");
    const configItem = items.find((item) => item.text().includes("世界配置"));
    expect(configItem).toBeTruthy();
    await configItem!.trigger("click");
    await flushPromises();

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @dst-admin/web exec vitest run src/App.test.ts -t "switches the visible page"`
Expected: FAIL —— 当前 AppShell 一次性渲染所有面板，总览状态下 `input[type="password"]` 已存在，第一个 `toBe(false)` 断言失败。

- [ ] **Step 3: 新建 LogsSummary.vue**

创建 `apps/web/src/components/LogsSummary.vue`，展示日志末尾 20 行，并提供「查看全部」按钮：

```vue
<template>
  <n-card class="log-card">
    <template #header>
      <div class="section-title">
        <span>日志摘要</span>
        <n-button tertiary size="small" @click="$emit('view-all')">查看全部</n-button>
      </div>
    </template>
    <pre class="log-card__content">{{ tail || "暂无日志输出" }}</pre>
  </n-card>
</template>

<script setup lang="ts">
import { NButton, NCard } from "naive-ui";
import { computed } from "vue";

const props = defineProps<{
  content: string;
}>();

defineEmits<{
  "view-all": [];
}>();

const tail = computed(() => props.content.split("\n").slice(-20).join("\n"));
</script>
```

- [ ] **Step 4: 改写 AppShell.vue 实现视图切换**

将 `apps/web/src/components/AppShell.vue` 的 `<template>` 改为按 `activeSection` 渲染单页，并让 Hero 随页变化、总览装配状态/控制/日志摘要。完整替换 `<template>...</template>` 为：

```vue
<template>
  <n-layout class="shell" has-sider>
    <n-layout-sider bordered collapse-mode="width" :collapsed-width="72" :width="240" class="shell__sider">
      <div class="shell__brand">
        <div class="shell__brand-mark">DST</div>
        <div>
          <p class="shell__brand-title">Steam Admin</p>
          <p class="shell__brand-subtitle">Server Console</p>
        </div>
      </div>
      <n-menu :options="menuOptions" :value="activeSection" @update:value="onMenuSelect" />
    </n-layout-sider>
    <n-layout-content class="shell__content">
      <header class="hero" :class="{ 'hero--solo': activeSection !== 'overview' }">
        <div>
          <p class="hero__eyebrow">饥荒联机版专用服务器</p>
          <h1>{{ heroTitle }}</h1>
          <p class="hero__copy">{{ heroCopy }}</p>
        </div>
        <StatusCard v-if="activeSection === 'overview'" :status="serverStatus" />
      </header>

      <section v-if="activeSection === 'overview'" class="panel-grid">
        <ControlPanel
          :busy-action="busyAction"
          @start="handleStart"
          @stop="handleStop"
          @restart="handleRestart"
        />
        <LogsSummary :content="logs" @view-all="activeSection = 'logs'" />
      </section>

      <section v-else-if="activeSection === 'logs'" class="page">
        <LogsPanel
          :content="logs"
          :loading="logsLoading"
          @refresh="refreshLogs"
        />
      </section>

      <section v-else-if="activeSection === 'config'" class="page">
        <ServerConfigForm
          :model-value="serverConfig"
          :steam-token-placeholder="serverConfig.steamTokenMasked ?? ''"
          :saving="configSaving"
          @update:model-value="serverConfig = $event"
          @save="saveConfig"
        />
      </section>

      <section v-else-if="activeSection === 'mods'" class="page">
        <ModsConfigPanel
          :model-value="modsConfig"
          :saving="modsSaving"
          @update:model-value="modsConfig = $event"
          @save="saveMods"
        />
      </section>

      <section v-else class="page">
        <DocsPanel :active-section="activeSection" />
      </section>
    </n-layout-content>
  </n-layout>
</template>
```

然后在 `<script setup>` 内做两处改动：

(a) 导入新增组件。把：

```ts
import LogsPanel from "./LogsPanel.vue";
```

替换为：

```ts
import LogsPanel from "./LogsPanel.vue";
import LogsSummary from "./LogsSummary.vue";
```

(b) 在 `menuOptions` 常量定义之后，新增 Hero 文案映射与计算属性（`computed` 已可用，因为文件已 `import { h, onMounted, ref } from "vue"` —— 需把这一行补上 `computed`）。先把：

```ts
import { h, onMounted, ref } from "vue";
```

替换为：

```ts
import { computed, h, onMounted, ref } from "vue";
```

再在 `menuOptions` 定义之后插入：

```ts
const heroMeta: Record<string, { title: string; copy: string }> = {
  overview: { title: "总览", copy: "查看运行状态，执行启停操作，并查看最近日志摘要。" },
  logs: { title: "实时日志", copy: "查看最近日志输出并手动刷新。" },
  config: { title: "世界配置", copy: "编辑房间名、密码、人数、端口等基础配置。" },
  mods: { title: "模组配置", copy: "编辑模组安装与覆盖配置文件。" },
  docs: { title: "部署说明", copy: "查看部署与运维命令。" }
};

const heroTitle = computed(() => heroMeta[activeSection.value]?.title ?? "总览");
const heroCopy = computed(() => heroMeta[activeSection.value]?.copy ?? "");
```

- [ ] **Step 5: 更新 token 测试先导航到配置页**

切换视图后总览页不再挂载配置表单，需让 `keeps the steam token input empty...` 测试先点开「世界配置」。在 `apps/web/src/App.test.ts` 中，把该测试里的：

```ts
    const wrapper = mount(App);
    await flushPromises();

    const steamTokenInput = wrapper.find('input[type="password"]');
```

替换为：

```ts
    const wrapper = mount(App);
    await flushPromises();

    const configItem = wrapper
      .findAll(".n-menu-item-content")
      .find((item) => item.text().includes("世界配置"));
    await configItem!.trigger("click");
    await flushPromises();

    const steamTokenInput = wrapper.find('input[type="password"]');
```

- [ ] **Step 6: 运行全部 web 测试确认通过**

Run: `pnpm --filter @dst-admin/web test`
Expected: PASS —— 含新增的 "switches the visible page"、更新后的 token 测试，以及原有 `ControlPanel.test.ts`、App 的导航标签测试。

- [ ] **Step 7: 类型检查**

Run: `pnpm --filter @dst-admin/web lint`
Expected: 无错误（vue-tsc 通过）。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/components/AppShell.vue apps/web/src/components/LogsSummary.vue apps/web/src/App.test.ts
git commit -m "FS-xxxx:[feat] 后台菜单真正切换视图并新增日志摘要"
```

（提交信息可改用全局 alias：`git feat "后台菜单真正切换视图并新增日志摘要"`，由分支名自动注入 ticket。）

---

### Task 2: 修复毛玻璃 —— 配置 Naive UI 暗色主题

**Files:**
- Modify: `apps/web/src/App.vue`

该任务为视觉/主题改动，不做单元断言（spec 约定），靠类型检查、现有测试不回归与浏览器人工核对验证。

- [ ] **Step 1: 在 App.vue 接入 darkTheme + themeOverrides**

将 `apps/web/src/App.vue` 完整替换为：

```vue
<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <n-notification-provider>
      <n-message-provider>
        <AppShell />
      </n-message-provider>
    </n-notification-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import {
  darkTheme,
  NConfigProvider,
  NMessageProvider,
  NNotificationProvider,
  type GlobalThemeOverrides
} from "naive-ui";

import AppShell from "./components/AppShell.vue";

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#e8994f",
    primaryColorHover: "#f0a860",
    primaryColorPressed: "#c75b43",
    primaryColorSuppl: "#f0a860",
    textColorBase: "#f5e9df",
    borderRadius: "12px"
  },
  Card: {
    color: "rgba(36, 23, 16, 0.5)",
    colorModal: "rgba(28, 18, 14, 0.92)",
    borderColor: "rgba(232, 205, 180, 0.18)"
  }
};
</script>
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @dst-admin/web lint`
Expected: 无错误。

- [ ] **Step 3: 现有测试不回归**

Run: `pnpm --filter @dst-admin/web test`
Expected: PASS（全部）。

- [ ] **Step 4: 浏览器人工核对**

Run: `pnpm --filter @dst-admin/web dev`，浏览器打开 Vite 提示的地址（约 `http://127.0.0.1:5173`）。
Expected: 卡片变为半透明暗色（暂未加 `backdrop-filter` 与暖色背景，颜色会偏暗），不再是白色不透明卡片。主按钮呈暖橙色。确认后 `Ctrl+C` 结束 dev。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/App.vue
git commit -m "FS-xxxx:[fix] 配置 Naive UI 暗色主题修复后台毛玻璃失效"
```

（或 `git fix "配置 Naive UI 暗色主题修复后台毛玻璃失效"`。）

---

### Task 3: 篝火暖橙配色与玻璃样式

**Files:**
- Modify: `apps/web/src/styles.css`

视觉改动，靠浏览器人工核对验证。

- [ ] **Step 1: 更新背景与文字基调**

在 `apps/web/src/styles.css` 中，把 `:root { ... }` 整段替换为：

```css
:root {
  font-family: "IBM Plex Sans", "PingFang SC", sans-serif;
  color: #f5e9df;
  background:
    radial-gradient(circle at 25% 15%, rgba(232, 153, 79, 0.42), transparent 45%),
    radial-gradient(circle at 85% 85%, rgba(180, 70, 60, 0.36), transparent 42%),
    linear-gradient(160deg, #241710 0%, #160d0b 60%, #0f0a0c 100%);
}
```

- [ ] **Step 2: 更新侧边栏与品牌强调色为暖橙**

把 `.shell__sider { ... }` 替换为：

```css
.shell__sider {
  background: rgba(22, 13, 11, 0.8);
  backdrop-filter: blur(16px);
  border-right: 1px solid rgba(232, 205, 180, 0.12);
}
```

把 `.shell__brand-mark { ... }` 中的 `background` 一行：

```css
  background: linear-gradient(135deg, #73b380, #2d8d8d);
```

替换为：

```css
  background: linear-gradient(135deg, #e8994f, #c75b43);
```

- [ ] **Step 3: Hero 强调色与单列布局**

把 `.hero__eyebrow { ... }` 中的 `color: #9ed0b4;` 替换为 `color: #f0a860;`。

然后在 `.hero { ... }` 规则之后新增单列变体：

```css
.hero--solo {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 4: 玻璃卡片改为依赖主题色 + 模糊**

把：

```css
.glass-card,
.docs-card {
  border: 1px solid rgba(180, 225, 198, 0.16);
  background: rgba(12, 34, 29, 0.66);
  backdrop-filter: blur(18px);
}
```

替换为（去掉硬编码背景，背景交给 `themeOverrides.Card.color`，这里只负责模糊与暖色边框）：

```css
.glass-card,
.docs-card {
  border: 1px solid rgba(232, 205, 180, 0.18);
  backdrop-filter: blur(18px);
}
```

- [ ] **Step 5: 日志卡片同样玻璃化，内层 pre 保持深色高对比**

把：

```css
.log-card {
  background: #081114;
  border: 1px solid rgba(94, 157, 190, 0.24);
}
```

替换为：

```css
.log-card {
  border: 1px solid rgba(232, 205, 180, 0.18);
  backdrop-filter: blur(18px);
}
```

把 `.log-card__content` 中的 `color: #b7ffcf;` 替换为 `color: #ffd9a8;`（暖色日志文字；其余 `background: rgba(0, 0, 0, 0.32)` 等保留，维持深色高对比）。

- [ ] **Step 6: 新增 .page 包裹样式**

在文件末尾的 `@media (max-width: 960px) { ... }` 之前，新增：

```css
.page {
  margin-bottom: 20px;
}
```

- [ ] **Step 7: 浏览器人工核对**

Run: `pnpm --filter @dst-admin/web dev`，打开 Vite 地址。
Expected:
- 背景为炭黑 + 篝火橙/余烬红光晕。
- 卡片呈半透明暖色玻璃，能透出背景光晕（毛玻璃生效）。
- 品牌标记、主按钮为暖橙渐变；运行状态标签仍是绿/灰/红语义色。
- 切换菜单时内容区整页切换；总览页有状态卡、启停控制、日志摘要「查看全部」可跳到日志页。
确认后 `Ctrl+C` 结束。

- [ ] **Step 8: 测试与类型检查不回归**

Run: `pnpm --filter @dst-admin/web test && pnpm --filter @dst-admin/web lint`
Expected: 均 PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/web/src/styles.css
git commit -m "FS-xxxx:[style] 后台改为篝火暖橙毛玻璃配色"
```

（或 `git style "后台改为篝火暖橙毛玻璃配色"`。）

---

## 验证清单（全部完成后）

- [ ] `pnpm --filter @dst-admin/web test` 全绿。
- [ ] `pnpm --filter @dst-admin/web lint` 无错误。
- [ ] 浏览器中：菜单点击整页切换；总览=状态+控制+日志摘要；毛玻璃可见；篝火暖橙配色；状态语义色保留。
