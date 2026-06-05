import { promises as fs } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import * as tar from "tar";

import { runCompose } from "../docker/compose.js";
import { parseComposeStatus } from "../docker/status.js";

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
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  return slug ? `-${slug}` : "";
}

export async function listBackups(projectRoot: string): Promise<BackupEntry[]> {
  const dir = backupDir(projectRoot);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
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
    // cluster_token.txt 只存在于 Cluster 根目录，顶层过滤即可排除 Steam 密钥
    entries = (await fs.readdir(src)).filter((entry) => entry !== TOKEN_FILENAME);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
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

export function resolveBackupPath(projectRoot: string, name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new BackupError("无效的备份文件名", 400);
  }
  const dir = backupDir(projectRoot);
  const full = resolve(dir, name);
  const rel = relative(dir, full);
  // NAME_PATTERN 已保证 name 非空且不含分隔符，rel === "" 仅作纵深防御
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new BackupError("无效的备份文件名", 400);
  }
  return full;
}

export async function deleteBackup(projectRoot: string, name: string): Promise<void> {
  const filePath = resolveBackupPath(projectRoot, name);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    throw new BackupError("备份不存在", 404);
  }
}

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
