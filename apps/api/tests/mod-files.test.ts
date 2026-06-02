import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
