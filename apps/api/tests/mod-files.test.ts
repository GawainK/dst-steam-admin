import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/mod-names.js", () => ({
  resolveModNames: vi.fn(async (_root: string, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, `name-${id}`]))
  )
}));

import { createConfigRouter } from "../src/config/routes.js";
import { readModFiles, writeModFiles } from "../src/config/mod-files.js";

interface HandleRouter {
  handle: (
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ) => void;
}

describe("mod file service", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists raw lua text for both mod files", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-mods-"));
    tempRoots.push(projectRoot);

    await writeModFiles(projectRoot, {
      setup: "ServerModSetup('workshop-1')\n",
      overrides: "return {}\n"
    });

    expect(await readModFiles(projectRoot)).toEqual({
      setup: "ServerModSetup('workshop-1')\n",
      overrides: "return {}\n"
    });
    expect(
      readFileSync(resolve(projectRoot, "data/mods/modoverrides.lua"), "utf8")
    ).toBe("return {}\n");
  });

  it("serves and updates mod file content through the API", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-mods-route-"));
    tempRoots.push(projectRoot);

    const putResponse = await requestConfigRouter(
      createConfigRouter(projectRoot) as unknown as HandleRouter,
      "/mods",
      "PUT",
      {
        setup: "ServerModSetup('workshop-1')\n",
        overrides: "return {}\n"
      }
    );

    const getResponse = await requestConfigRouter(
      createConfigRouter(projectRoot) as unknown as HandleRouter,
      "/mods",
      "GET"
    );

    expect(putResponse.status).toBe(200);
    expect(getResponse.body).toEqual({
      setup: "ServerModSetup('workshop-1')\n",
      overrides: "return {}\n"
    });
  });
});

describe("结构化模组列表", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });

  function seededRoot() {
    const root = mkdtempSync(resolve(tmpdir(), "dst-mods-list-"));
    tempRoots.push(root);
    return root;
  }

  it("GET /mods/list 合并 setup、overrides 与名称", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("111")\nServerModSetup("222")\n',
      overrides:
        'return {\n  ["workshop-111"]={ enabled=true },\n  ["workshop-222"]={ enabled=false }\n}\n'
    });

    const res = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { id: "111", name: "name-111", enabled: true, inSetup: true, configRaw: '["workshop-111"]={ enabled=true }' },
        { id: "222", name: "name-222", enabled: false, inSetup: true, configRaw: '["workshop-222"]={ enabled=false }' }
      ]
    });
  });

  it("POST /mods 新增模组到两个文件", async () => {
    const root = seededRoot();
    await writeModFiles(root, { setup: "", overrides: "return {}\n" });

    const post = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods",
      "POST",
      { id: "555" }
    );
    expect(post.status).toBe(200);

    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["555"]);
  });

  it("POST /mods 非法 ID 返回 400", async () => {
    const root = seededRoot();
    await writeModFiles(root, { setup: "", overrides: "return {}\n" });
    const post = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods",
      "POST",
      { id: "abc" }
    );
    expect(post.status).toBe(400);
  });

  it("DELETE /mods/:id 移除模组", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("111")\n',
      overrides: 'return {\n  ["workshop-111"]={ enabled=true }\n}\n'
    });
    const del = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/111",
      "DELETE"
    );
    expect(del.status).toBe(200);
    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect((list.body as { items: unknown[] }).items).toEqual([]);
  });

  it("DELETE /mods/:id 不存在返回 404", async () => {
    const root = seededRoot();
    await writeModFiles(root, { setup: "", overrides: "return {}\n" });
    const del = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/777",
      "DELETE"
    );
    expect(del.status).toBe(404);
  });

  it("GET /mods/list 返回仅在 setup 中的模组，enabled 为 false，configRaw 为空", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("888")\n',
      overrides: "return {}\n"
    });
    const res = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect(res.status).toBe(200);
    const item = (res.body as { items: { id: string; inSetup: boolean; enabled: boolean; configRaw: string }[] }).items.find((i) => i.id === "888");
    expect(item?.inSetup).toBe(true);
    expect(item?.enabled).toBe(false);
    expect(item?.configRaw).toBe("");
  });

  it("PATCH /mods/:id 对仅在 setup 中的模组返回 200，后续 GET 显示 enabled:true", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("888")\n',
      overrides: "return {}\n"
    });
    const patch = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/888",
      "PATCH",
      { enabled: true }
    );
    expect(patch.status).toBe(200);
    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    const item = (list.body as { items: { id: string; enabled: boolean }[] }).items.find((i) => i.id === "888");
    expect(item?.enabled).toBe(true);
  });

  it("PATCH /mods/:id 翻转 enabled", async () => {
    const root = seededRoot();
    await writeModFiles(root, {
      setup: 'ServerModSetup("111")\n',
      overrides: 'return {\n  ["workshop-111"]={ enabled=true }\n}\n'
    });
    const patch = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/111",
      "PATCH",
      { enabled: false }
    );
    expect(patch.status).toBe(200);
    const list = await requestConfigRouter(
      createConfigRouter(root) as unknown as HandleRouter,
      "/mods/list",
      "GET"
    );
    expect((list.body as { items: { enabled: boolean }[] }).items[0].enabled).toBe(false);
  });
});

async function requestConfigRouter(
  router: HandleRouter,
  path: string,
  method: string,
  body?: unknown
) {
  const request = {
    method,
    url: path,
    originalUrl: path,
    path,
    body
  };
  const responseState: { status: number; body?: unknown } = {
    status: 200
  };

  await new Promise<void>((resolveRequest, reject) => {
    const response = {
      status(code: number) {
        responseState.status = code;
        return this;
      },
      json(payload: unknown) {
        responseState.body = payload;
        resolveRequest();
        return this;
      }
    };

    router.handle(
      request as never,
      response as never,
      (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }

        resolveRequest();
      }
    );
  });

  return responseState;
}
