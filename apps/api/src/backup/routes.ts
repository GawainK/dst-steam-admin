import type { NextFunction, Response } from "express";
import { Router } from "express";

import {
  BackupError,
  createBackup,
  deleteBackup,
  listBackups,
  resolveBackupPath,
  restoreBackup
} from "./service.js";

function handleError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof BackupError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

export function createBackupRouter(projectRoot: string): Router {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      response.json({ items: await listBackups(projectRoot) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const label =
        typeof request.body?.label === "string" ? request.body.label : undefined;
      response.json(await createBackup(projectRoot, label));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post("/:name/restore", async (request, response, next) => {
    try {
      await restoreBackup(projectRoot, request.params.name);
      response.json({ ok: true });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.delete("/:name", async (request, response, next) => {
    try {
      await deleteBackup(projectRoot, request.params.name);
      response.json({ ok: true });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get("/:name/download", (request, response, next) => {
    try {
      response.download(resolveBackupPath(projectRoot, request.params.name));
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
}
