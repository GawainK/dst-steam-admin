import { Router } from "express";

import {
  getServerLogs,
  getServerStatus,
  runServerAction
} from "./service.js";

export function createServerRouter(projectRoot: string): Router {
  const router = Router();

  router.get("/status", async (_request, response, next) => {
    try {
      response.json(await getServerStatus(projectRoot));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:action(start|stop|restart)", async (request, response, next) => {
    try {
      await runServerAction(
        projectRoot,
        request.params.action as "start" | "stop" | "restart"
      );
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/logs", async (request, response, next) => {
    try {
      response.json(
        await getServerLogs(projectRoot, String(request.query.lines ?? ""))
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
