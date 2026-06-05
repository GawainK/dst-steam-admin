import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    await expect(createBackup(projectRoot)).rejects.toMatchObject({
      message: "暂无可备份的存档",
      status: 409
    });
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
    await fs.utimes(resolve(dir, "dst-save-20260101-000000.tar.gz"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    await fs.utimes(resolve(dir, "dst-save-20260202-000000.tar.gz"), new Date("2026-02-02T00:00:00Z"), new Date("2026-02-02T00:00:00Z"));

    const items = await listBackups(projectRoot);

    expect(items.map((i) => i.name)).toEqual([
      "dst-save-20260202-000000.tar.gz",
      "dst-save-20260101-000000.tar.gz"
    ]);
    expect(items[0].size).toBe(2);
  });
});
