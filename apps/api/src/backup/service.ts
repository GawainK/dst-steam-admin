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
