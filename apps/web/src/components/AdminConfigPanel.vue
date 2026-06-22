<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>管理员设置</span>
        <span class="section-subtitle">管理 DST 世界内管理员 Klei ID</span>
      </div>
    </template>

    <div class="add-row">
      <n-input
        v-model:value="newId"
        placeholder="输入 Klei ID，如 KU_xxxxxxxx"
        @keyup.enter="onAdd"
      />
      <n-button type="primary" :loading="adding" @click="onAdd">添加</n-button>
    </div>

    <n-spin :show="loading">
      <n-empty v-if="items.length === 0" description="暂无管理员" class="empty" />
      <n-list v-else bordered>
        <n-list-item v-for="item in items" :key="item.id">
          <div class="admin-row">
            <div class="admin-info">
              <span class="admin-id">{{ item.id }}</span>
              <span class="admin-meta">Klei 用户 ID</span>
            </div>
            <n-popconfirm @positive-click="() => onRemove(item)">
              <template #trigger>
                <n-button quaternary type="error" size="small" :data-testid="`remove-admin-${item.id}`">
                  删除
                </n-button>
              </template>
              确认删除该管理员？
            </n-popconfirm>
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
  addAdmin,
  getAdminList,
  removeAdmin,
  type AdminListItem
} from "../api/client";

const message = useMessage();
const items = ref<AdminListItem[]>([]);
const loading = ref(false);
const adding = ref(false);
const newId = ref("");

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

async function refresh() {
  loading.value = true;
  try {
    items.value = (await getAdminList()).items;
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    loading.value = false;
  }
}

async function onAdd() {
  const id = newId.value.trim();
  if (!id || adding.value) return;

  adding.value = true;
  try {
    await addAdmin(id);
    newId.value = "";
    message.success("已添加管理员，通常需重启服务器或重新进入世界后生效");
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    adding.value = false;
  }
}

async function onRemove(item: AdminListItem) {
  try {
    await removeAdmin(item.id);
    message.success("已删除管理员，通常需重启服务器或重新进入世界后生效");
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  }
}

onMounted(refresh);
</script>

<style scoped>
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.admin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.admin-info {
  display: flex;
  flex-direction: column;
}
.admin-id {
  font-weight: 600;
  word-break: break-all;
}
.admin-meta {
  font-size: 12px;
  opacity: 0.7;
}
.empty {
  padding: 24px 0;
}
</style>
