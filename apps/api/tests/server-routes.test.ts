import { afterEach, describe, expect, it, vi } from "vitest";

const runComposeMock = vi.hoisted(() => vi.fn());
const parseComposeStatusMock = vi.hoisted(() => vi.fn());
const getServerCheckMock = vi.hoisted(() => vi.fn());

vi.mock("../src/server/check.js", () => ({ getServerCheck: getServerCheckMock }));

vi.mock("../src/docker/compose.js", () => ({
  runCompose: runComposeMock
}));

vi.mock("../src/docker/status.js", () => ({
  parseComposeStatus: parseComposeStatusMock
}));

import { createServerRouter } from "../src/server/routes.js";

interface HandleRouter {
  handle: (
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ) => void;
}

async function requestRouter(
  path: string,
  method: string,
  router: HandleRouter = createServerRouter(process.cwd()) as unknown as HandleRouter
) {
  const request = {
    method,
    url: path,
    originalUrl: path,
    path,
    query: {} as Record<string, string | undefined>,
    params: {} as Record<string, string>
  };
  const responseState: { status: number; body?: unknown; headers: Record<string, string> } = {
    status: 200, headers: {}
  };

  const queryIndex = path.indexOf("?");
  if (queryIndex >= 0) {
    request.path = path.slice(0, queryIndex);
    request.url = request.path;
    request.query = Object.fromEntries(
      new URLSearchParams(path.slice(queryIndex + 1)).entries()
    );
  }

  await new Promise<void>((resolve, reject) => {
    const response = {
      setHeader(name: string, value: string) {
        responseState.headers[name] = value;
        return this;
      },
      status(code: number) {
        responseState.status = code;
        return this;
      },
      json(body: unknown) {
        responseState.body = body;
        resolve();
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

        resolve();
      }
    );
  });

  return responseState;
}

afterEach(() => {
  runComposeMock.mockReset();
  parseComposeStatusMock.mockReset();
  getServerCheckMock.mockReset();
});

describe("server routes", () => {
  it("returns a fresh structured report without caching partial check results", async () => {
    const report = { overall: "check", image: { current: null }, mods: [] };
    getServerCheckMock.mockResolvedValue(report);
    const response = await requestRouter("/check", "GET");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(report);
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(getServerCheckMock).toHaveBeenCalledWith(process.cwd());
    expect(runComposeMock).not.toHaveBeenCalled();
  });

  it("returns parsed status from docker compose output", async () => {
    runComposeMock.mockResolvedValue({ stdout: "[]", stderr: "" });
    parseComposeStatusMock.mockReturnValue({
      overall: "stopped",
      containers: []
    });

    const response = await requestRouter("/status", "GET");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ overall: "stopped", containers: [] });
  });

  it.each(["start", "stop", "restart"] as const)(
    "runs %s through docker compose",
    async (action) => {
      runComposeMock.mockResolvedValue({ stdout: "ok", stderr: "" });

      const response = await requestRouter(`/${action}`, "POST");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(runComposeMock).toHaveBeenCalledWith(action, process.cwd());
    }
  );

  it("returns log output from docker compose", async () => {
    runComposeMock.mockResolvedValue({ stdout: "log line", stderr: "" });

    const response = await requestRouter("/logs?lines=5000", "GET");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ content: "log line" });
    expect(runComposeMock).toHaveBeenCalledWith("logs", process.cwd(), "5000");
  });
});
