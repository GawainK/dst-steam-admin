import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createConfigRouter } from "../src/config/routes.js";
import { readServerConfig, writeServerConfig } from "../src/config/server-config.js";

interface HandleRouter {
  handle: (
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ) => void;
}

describe("server config", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("writes validated config and masks steam token on read", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-"));
    tempRoots.push(projectRoot);

    await writeServerConfig(projectRoot, {
      steamToken: "abc123",
      clusterName: "Test Cluster",
      clusterPassword: "secret",
      maxPlayers: 6,
      gameMode: "survival",
      enableCaves: true,
      masterPort: 10999,
      cavesPort: 11000
    });

    const result = await readServerConfig(projectRoot);

    expect(result).toMatchObject({
      steamTokenMasked: "abc***",
      clusterName: "Test Cluster",
      enableCaves: true
    });
    expect(
      JSON.parse(
        readFileSync(
          resolve(projectRoot, "data/cluster/admin/server-config.json"),
          "utf8"
        )
      )
    ).toMatchObject({ steamToken: "abc123" });
  });

  it("rejects invalid maxPlayers values through the config API", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-route-"));
    tempRoots.push(projectRoot);

    const response = await requestConfigRouter(
      createConfigRouter(projectRoot) as unknown as HandleRouter,
      "/server",
      "PUT",
      {
        steamToken: "abc123",
        clusterName: "Test Cluster",
        clusterPassword: "",
        maxPlayers: 0,
        gameMode: "survival",
        enableCaves: true,
        masterPort: 10999,
        cavesPort: 11000
      }
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("abc123");
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
          const responseError = error as { status?: number; body?: unknown };
          responseState.status = responseError.status ?? 500;
          responseState.body = responseError.body ?? {
            error: error instanceof Error ? error.message : "unknown error"
          };
          resolveRequest();
          return;
        }

        resolveRequest();
      }
    );
  });

  return responseState;
}
