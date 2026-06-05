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
