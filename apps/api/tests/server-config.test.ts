import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      steamToken: "",
      clusterName: "Test Cluster",
      enableCaves: true
    });
    expect(result).not.toHaveProperty("steamToken", "abc123");
    expect(
      JSON.parse(
        readFileSync(
          resolve(projectRoot, "data/cluster/admin/server-config.json"),
          "utf8"
        )
      )
    ).toMatchObject({ steamToken: "abc123" });
  });

  it("returns editable defaults before the first server config is saved", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-defaults-"));
    tempRoots.push(projectRoot);

    await expect(readServerConfig(projectRoot)).resolves.toEqual({
      steamToken: "",
      steamTokenMasked: "",
      clusterName: "DST Steam Admin",
      clusterPassword: "",
      maxPlayers: 6,
      gameMode: "survival",
      enableCaves: true,
      masterPort: 10999,
      cavesPort: 11000
    });
  });

  it("loads an existing draft with an empty token so it can be configured for the first time", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-draft-"));
    tempRoots.push(projectRoot);
    const configDir = resolve(projectRoot, "data/cluster/admin");
    const configPath = resolve(configDir, "server-config.json");
    const draft = {
      steamToken: "", clusterName: "My Draft", clusterPassword: "",
      maxPlayers: 8, gameMode: "endless", enableCaves: false,
      masterPort: 10999, cavesPort: 11000
    };
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(draft));

    const response = await requestConfigRouter(
      createConfigRouter(projectRoot) as unknown as HandleRouter, "/server", "GET"
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...draft, steamTokenMasked: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(draft);

    const save = await requestConfigRouter(
      createConfigRouter(projectRoot) as unknown as HandleRouter, "/server", "PUT", draft
    );
    expect(save.status).toBe(400);
    expect(save.body).toMatchObject({ fields: { steamToken: [expect.any(String)] } });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(draft);

    await writeServerConfig(projectRoot, { ...draft, gameMode: "endless", steamToken: "abc123" });
    await expect(readServerConfig(projectRoot)).resolves.toMatchObject({
      steamToken: "", steamTokenMasked: "abc***", clusterName: "My Draft"
    });
  });

  it("still rejects other invalid fields when reading a draft with no token", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-invalid-draft-"));
    tempRoots.push(projectRoot);
    const configDir = resolve(projectRoot, "data/cluster/admin");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "server-config.json"), JSON.stringify({
      steamToken: "", clusterName: "Draft", clusterPassword: "", maxPlayers: 0,
      gameMode: "survival", enableCaves: true, masterPort: 10999, cavesPort: 11000
    }));
    await expect(readServerConfig(projectRoot)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ["maxPlayers"] })])
    });
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

  it("preserves the stored steam token when saving other fields with an empty token", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "dst-config-preserve-"));
    tempRoots.push(projectRoot);

    await writeServerConfig(projectRoot, {
      steamToken: "abc123",
      clusterName: "Original Cluster",
      clusterPassword: "secret",
      maxPlayers: 6,
      gameMode: "survival",
      enableCaves: true,
      masterPort: 10999,
      cavesPort: 11000
    });

    const response = await requestConfigRouter(
      createConfigRouter(projectRoot) as unknown as HandleRouter,
      "/server",
      "PUT",
      {
        steamToken: "",
        clusterName: "Updated Cluster",
        clusterPassword: "secret",
        maxPlayers: 8,
        gameMode: "endless",
        enableCaves: true,
        masterPort: 10999,
        cavesPort: 11000
      }
    );

    expect(response.status).toBe(200);
    expect(
      JSON.parse(
        readFileSync(
          resolve(projectRoot, "data/cluster/admin/server-config.json"),
          "utf8"
        )
      )
    ).toMatchObject({
      steamToken: "abc123",
      clusterName: "Updated Cluster",
      maxPlayers: 8,
      gameMode: "endless"
    });
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
