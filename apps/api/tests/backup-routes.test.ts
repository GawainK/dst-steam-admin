import { afterEach, describe, expect, it, vi } from "vitest";

const listBackupsMock = vi.hoisted(() => vi.fn());
const createBackupMock = vi.hoisted(() => vi.fn());
const restoreBackupMock = vi.hoisted(() => vi.fn());
const deleteBackupMock = vi.hoisted(() => vi.fn());
const resolveBackupPathMock = vi.hoisted(() => vi.fn());
const BackupError = vi.hoisted(
  () =>
    class BackupError extends Error {
      readonly status: number;
      constructor(message: string, status: number) {
        super(message);
        this.name = "BackupError";
        this.status = status;
      }
    }
);

vi.mock("../src/backup/service.js", () => ({
  BackupError,
  listBackups: listBackupsMock,
  createBackup: createBackupMock,
  restoreBackup: restoreBackupMock,
  deleteBackup: deleteBackupMock,
  resolveBackupPath: resolveBackupPathMock
}));

import { createBackupRouter } from "../src/backup/routes.js";

interface HandleRouter {
  handle: (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
}

async function call(
  path: string,
  method: string,
  body?: unknown,
  params: Record<string, string> = {}
) {
  const router = createBackupRouter(process.cwd()) as unknown as HandleRouter;
  const request = { method, url: path, originalUrl: path, path, query: {}, params, body };
  const state: { status: number; body?: unknown } = { status: 200 };
  await new Promise<void>((resolve, reject) => {
    const response = {
      status(code: number) { state.status = code; return this; },
      json(payload: unknown) { state.body = payload; resolve(); return this; }
    };
    router.handle(request as never, response as never, (error?: unknown) =>
      error ? reject(error) : resolve()
    );
  });
  return state;
}

afterEach(() => vi.clearAllMocks());

describe("backup routes", () => {
  it("GET / 返回列表", async () => {
    listBackupsMock.mockResolvedValue([{ name: "a.tar.gz", createdAt: "x", size: 1 }]);
    const res = await call("/", "GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ name: "a.tar.gz", createdAt: "x", size: 1 }] });
  });

  it("POST / 创建并返回条目", async () => {
    createBackupMock.mockResolvedValue({ name: "a.tar.gz", createdAt: "x", size: 1 });
    const res = await call("/", "POST", { label: "snap" });
    expect(res.status).toBe(200);
    expect(createBackupMock).toHaveBeenCalledWith(process.cwd(), "snap");
  });

  it("POST /:name/restore 运行中返回 409", async () => {
    restoreBackupMock.mockRejectedValue(new BackupError("请先停止服务器再恢复", 409));
    const res = await call("/a.tar.gz/restore", "POST", undefined, { name: "a.tar.gz" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "请先停止服务器再恢复" });
  });

  it("DELETE /:name 不存在返回 404", async () => {
    deleteBackupMock.mockRejectedValue(new BackupError("备份不存在", 404));
    const res = await call("/a.tar.gz", "DELETE", undefined, { name: "a.tar.gz" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "备份不存在" });
  });

  it("GET /:name/download 文件不存在返回 404", async () => {
    resolveBackupPathMock.mockReturnValue("/nonexistent/does-not-exist.tar.gz");
    const res = await call("/a.tar.gz/download", "GET", undefined, { name: "a.tar.gz" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "备份不存在" });
  });
});
