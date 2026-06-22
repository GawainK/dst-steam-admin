import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createConfigRouter } from "../src/config/routes.js";
import {
  addAdmin,
  deleteAdmin,
  listAdmins,
  normalizeKleiId
} from "../src/config/admin-list.js";

interface HandleRouter {
  handle: (
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ) => void;
}

describe("DST admin list service", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot() {
    const root = mkdtempSync(resolve(tmpdir(), "dst-admin-list-"));
    tempRoots.push(root);
    return root;
  }

  function seedAdminList(projectRoot: string, content: string) {
    const dir = resolve(projectRoot, "data/cluster/DoNotStarveTogether/Cluster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "adminlist.txt"), content);
  }

  it("returns an empty list when adminlist.txt does not exist", async () => {
    await expect(listAdmins(tempRoot())).resolves.toEqual({ items: [] });
  });

  it("normalizes prefixes, persists, and de-duplicates Klei IDs", async () => {
    const root = tempRoot();

    await addAdmin(root, "  ku_abc123  ");
    await addAdmin(root, "KU_abc123");

    expect(await listAdmins(root)).toEqual({
      items: [{ id: "KU_abc123" }]
    });
    expect(
      readFileSync(
        resolve(root, "data/cluster/DoNotStarveTogether/Cluster/adminlist.txt"),
        "utf8"
      )
    ).toBe("KU_abc123\n");
  });

  it("deletes an existing admin ID", async () => {
    const root = tempRoot();
    seedAdminList(root, "KU_FIRST\nKU_SECOND\n");

    await deleteAdmin(root, "KU_FIRST");

    expect(await listAdmins(root)).toEqual({
      items: [{ id: "KU_SECOND" }]
    });
  });

  it("rejects invalid Klei IDs", () => {
    expect(normalizeKleiId("")).toBeNull();
    expect(normalizeKleiId("admin")).toBeNull();
    expect(normalizeKleiId("KU_")).toBeNull();
  });
});

describe("DST admin list routes", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot() {
    const root = mkdtempSync(resolve(tmpdir(), "dst-admin-list-route-"));
    tempRoots.push(root);
    return root;
  }

  it("serves, adds, and removes admins through config API", async () => {
    const root = tempRoot();
    const router = createConfigRouter(root) as unknown as HandleRouter;

    const empty = await requestConfigRouter(router, "/admins", "GET");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [] });

    const add = await requestConfigRouter(router, "/admins", "POST", {
      id: "KU_ADMIN1"
    });
    expect(add.status).toBe(200);

    const list = await requestConfigRouter(router, "/admins", "GET");
    expect(list.body).toEqual({ items: [{ id: "KU_ADMIN1" }] });

    const del = await requestConfigRouter(router, "/admins/KU_ADMIN1", "DELETE");
    expect(del.status).toBe(200);
    expect((await requestConfigRouter(router, "/admins", "GET")).body).toEqual({
      items: []
    });
  });

  it("returns 400 for invalid admin IDs", async () => {
    const router = createConfigRouter(tempRoot()) as unknown as HandleRouter;

    const response = await requestConfigRouter(router, "/admins", "POST", {
      id: "not-a-klei-id"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "缺少有效的 Klei 用户 ID" });
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
    body,
    params: {} as Record<string, string>
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
