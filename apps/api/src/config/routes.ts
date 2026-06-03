import { Router } from "express";
import { ZodError } from "zod";

import { readModFiles, writeModFiles } from "./mod-files.js";
import { resolveModNames } from "./mod-names.js";
import { ModParseError, parseOverrides, parseSetup } from "./mods-parser.js";
import { readServerConfig, writeServerConfig } from "./server-config.js";

function toValidationBody(error: ZodError) {
  return {
    error: "Invalid server config",
    fields: error.flatten().fieldErrors
  };
}

export function createConfigRouter(projectRoot: string): Router {
  const router = Router();

  router.get("/server", async (_request, response, next) => {
    try {
      response.json(await readServerConfig(projectRoot));
    } catch (error) {
      next(error);
    }
  });

  router.put("/server", async (request, response, next) => {
    try {
      await writeServerConfig(projectRoot, request.body);
      response.json({ ok: true });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json(toValidationBody(error));
        return;
      }

      next(error);
    }
  });

  router.get("/mods", async (_request, response, next) => {
    try {
      response.json(await readModFiles(projectRoot));
    } catch (error) {
      next(error);
    }
  });

  router.put("/mods", async (request, response, next) => {
    try {
      await writeModFiles(projectRoot, request.body);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/mods/list", async (_request, response, next) => {
    try {
      const files = await readModFiles(projectRoot);
      const setupIds = parseSetup(files.setup);
      const overrides = parseOverrides(files.overrides);
      const ids = Array.from(new Set([...setupIds, ...overrides.map((entry) => entry.id)]));
      const names = await resolveModNames(projectRoot, ids);

      const items = ids.map((id) => {
        const entry = overrides.find((candidate) => candidate.id === id);
        return {
          id,
          name: names[id] ?? null,
          enabled: entry?.enabled ?? false,
          inSetup: setupIds.includes(id),
          configRaw: entry?.raw ?? ""
        };
      });

      response.json({ items });
    } catch (error) {
      if (error instanceof ModParseError) {
        response.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}
