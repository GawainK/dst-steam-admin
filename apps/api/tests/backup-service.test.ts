import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runComposeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/docker/compose.js", () => ({ runCompose: runComposeMock }));

import { createBackup, deleteBackup, listBackups, resolveBackupPath, restoreBackup } from "../src/backup/service.js";

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
  runComposeMock.mockReset();
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

describe("resolveBackupPath", () => {
  it("合法名返回 data/backups 内的绝对路径", () => {
    const path = resolveBackupPath(projectRoot, "dst-save-20260101-000000.tar.gz");
    expect(path).toBe(
      resolve(projectRoot, "data/backups", "dst-save-20260101-000000.tar.gz")
    );
  });

  it("非法名（路径穿越/非 tar.gz）抛错", () => {
    for (const bad of ["../secret", "evil.sh", "a/b.tar.gz"]) {
      expect(() => resolveBackupPath(projectRoot, bad)).toThrow();
      expect(() => resolveBackupPath(projectRoot, bad)).toThrow(
        expect.objectContaining({ status: 400 })
      );
    }
  });
});

describe("deleteBackup", () => {
  it("删除存在的备份", async () => {
    const dir = resolve(projectRoot, "data/backups");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolve(dir, "dst-save-20260101-000000.tar.gz"), "a");
    await deleteBackup(projectRoot, "dst-save-20260101-000000.tar.gz");
    await expect(
      fs.access(resolve(dir, "dst-save-20260101-000000.tar.gz"))
    ).rejects.toThrow();
  });

  it("删除不存在的备份抛 404", async () => {
    await expect(
      deleteBackup(projectRoot, "dst-save-20260101-000000.tar.gz")
    ).rejects.toMatchObject({ status: 404 });
  });
});

const STOPPED = JSON.stringify([
  { Service: "dst-master", State: "exited", Status: "Exited", Publishers: null },
  { Service: "dst-caves", State: "exited", Status: "Exited", Publishers: null }
]);
const RUNNING = JSON.stringify([
  { Service: "dst-master", State: "running", Status: "Up", Publishers: null },
  { Service: "dst-caves", State: "running", Status: "Up", Publishers: null }
]);

describe("restoreBackup", () => {
  it("服务器运行中时拒绝并抛 409", async () => {
    runComposeMock.mockResolvedValue({ stdout: RUNNING, stderr: "" });
    await seedSave({ "cluster.ini": "x" });
    const { name } = await createBackup(projectRoot);
    await expect(restoreBackup(projectRoot, name)).rejects.toMatchObject({ status: 409 });
  });

  it("保留 cluster_token.txt 并完整替换世界内容", async () => {
    runComposeMock.mockResolvedValue({ stdout: STOPPED, stderr: "" });
    await seedSave({ "cluster.ini": "OLD", "cluster_token.txt": "SECRET", "stale.txt": "remove-me" });
    const { name } = await createBackup(projectRoot);

    const src = resolve(projectRoot, SAVE_REL);
    await fs.rm(resolve(src, "cluster.ini"));
    await fs.writeFile(resolve(src, "cluster_token.txt"), "KEPT");
    await fs.writeFile(resolve(src, "after-backup.txt"), "should-be-gone");

    await restoreBackup(projectRoot, name);

    expect(await fs.readFile(resolve(src, "cluster.ini"), "utf8")).toBe("OLD");
    await expect(fs.access(resolve(src, "after-backup.txt"))).rejects.toThrow();
    expect(await fs.readFile(resolve(src, "cluster_token.txt"), "utf8")).toBe("KEPT");
  });

  it("恢复不存在的备份抛 404", async () => {
    runComposeMock.mockResolvedValue({ stdout: STOPPED, stderr: "" });
    await expect(
      restoreBackup(projectRoot, "dst-save-20260101-000000.tar.gz")
    ).rejects.toMatchObject({ status: 404 });
  });

  it("损坏的归档抛 422 且不破坏现有存档", async () => {
    runComposeMock.mockResolvedValue({ stdout: STOPPED, stderr: "" });
    await seedSave({ "cluster.ini": "OLD" });
    const badName = "dst-save-20260101-120000.tar.gz";
    const dir = resolve(projectRoot, "data/backups");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolve(dir, badName), "not a real gzip archive");

    await expect(restoreBackup(projectRoot, badName)).rejects.toMatchObject({ status: 422 });

    // 解压失败发生在清空之前：现有存档必须原样保留
    const src = resolve(projectRoot, SAVE_REL);
    expect(await fs.readFile(resolve(src, "cluster.ini"), "utf8")).toBe("OLD");
  });
});
