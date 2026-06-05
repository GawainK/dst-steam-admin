import { beforeEach, describe, expect, it, vi } from "vitest";

const runComposeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/docker/compose.js", () => ({ runCompose: runComposeMock }));

import { __resetReadyLatch, getServerStatus, runServerAction } from "../src/server/service.js";

const RUNNING_STATUS = JSON.stringify([
  { Service: "dst-master", Name: "x-dst-master-1", State: "running", Status: "Up 1 minute", Publishers: null },
  { Service: "dst-caves", Name: "x-dst-caves-1", State: "running", Status: "Up 1 minute", Publishers: null }
]);
const STOPPED_STATUS = JSON.stringify([
  { Service: "dst-master", Name: "x-dst-master-1", State: "exited", Status: "Exited", Publishers: null },
  { Service: "dst-caves", Name: "x-dst-caves-1", State: "exited", Status: "Exited", Publishers: null }
]);
const READY_LOGS = "Starting DST shard Master\n[00:06:59]: Server registered via geo DNS";
const STARTING_LOGS = "Starting DST shard Master\n[00:00:00]: loaded modindex";

function mockCompose(statusOut: string, logsOut = STARTING_LOGS) {
  runComposeMock.mockImplementation(async (action: string) => {
    if (action === "logs") return { stdout: logsOut, stderr: "" };
    return { stdout: statusOut, stderr: "" };
  });
}

function logCalls() {
  return runComposeMock.mock.calls.filter(([action]) => action === "logs");
}

beforeEach(() => {
  runComposeMock.mockReset();
  __resetReadyLatch();
});

describe("getServerStatus readiness latch", () => {
  it("首次 running 轮询扫描日志，就绪则返回 running", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    const status = await getServerStatus("/root");
    expect(status.overall).toBe("running");
    expect(runComposeMock).toHaveBeenCalledWith("logs", "/root", "1000");
  });

  it("latch 置位后后续 running 轮询不再扫描日志", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    await getServerStatus("/root");
    runComposeMock.mockClear();
    const status = await getServerStatus("/root");
    expect(status.overall).toBe("running");
    expect(logCalls()).toHaveLength(0);
  });

  it("无就绪标记时返回 starting 且不置位 latch", async () => {
    mockCompose(RUNNING_STATUS, STARTING_LOGS);
    expect((await getServerStatus("/root")).overall).toBe("starting");
    runComposeMock.mockClear();
    expect((await getServerStatus("/root")).overall).toBe("starting");
    expect(logCalls()).toHaveLength(1);
  });

  it("容器不再运行时 latch 失效，再次 running 会重扫", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    await getServerStatus("/root");
    mockCompose(STOPPED_STATUS, READY_LOGS);
    expect((await getServerStatus("/root")).overall).toBe("stopped");
    mockCompose(RUNNING_STATUS, READY_LOGS);
    runComposeMock.mockClear();
    const status = await getServerStatus("/root");
    expect(status.overall).toBe("running");
    expect(logCalls()).toHaveLength(1);
  });

  it("执行 server action 后 latch 失效", async () => {
    mockCompose(RUNNING_STATUS, READY_LOGS);
    await getServerStatus("/root");
    await runServerAction("/root", "restart");
    mockCompose(RUNNING_STATUS, READY_LOGS);
    runComposeMock.mockClear();
    await getServerStatus("/root");
    expect(logCalls()).toHaveLength(1);
  });
});
