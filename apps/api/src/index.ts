import express from "express";

import { createBackupRouter } from "./backup/routes.js";
import { getProjectRoot } from "./config/paths.js";
import { createConfigRouter } from "./config/routes.js";
import { createServerRouter } from "./server/routes.js";

const DEFAULT_PORT = 3000;

export function createApp() {
  const app = express();
  const projectRoot = getProjectRoot();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api/server", createServerRouter(projectRoot));
  app.use("/api/config", createConfigRouter(projectRoot));
  app.use("/api/backups", createBackupRouter(projectRoot));

  app.use(
    (
      error: Error,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      response.status(500).json({
        error: error.message
      });
    }
  );

  return app;
}

const app = createApp();
const port = Number(process.env.PORT ?? DEFAULT_PORT);

app.listen(port, () => {
  console.log(`api listening on ${port}`);
});
