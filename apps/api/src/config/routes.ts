import { Router } from "express";
import { ZodError } from "zod";

import { readModFiles, writeModFiles } from "./mod-files.js";
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

  return router;
}
