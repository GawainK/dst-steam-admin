import type { NextFunction, Response } from "express";
import { Router } from "express";
import { promises as fs } from "node:fs";

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

  router.get("/:name/download", async (request, response, next) => {
    try {
      const filePath = resolveBackupPath(projectRoot, request.params.name);
      try {
        await fs.access(filePath);
      } catch {
        throw new BackupError("备份不存在", 404);
      }
      response.download(filePath);
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
}
