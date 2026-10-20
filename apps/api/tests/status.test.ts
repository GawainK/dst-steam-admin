import { describe, expect, it } from "vitest";

import { isServerReady, parseComposeStatus } from "../src/docker/status.js";

describe("parseComposeStatus", () => {
  it("reports the combined container as running and ignores admin containers", () => {
    const output = JSON.stringify([
      { Service: "dst-server", Name: "dst-steam-admin-dst-server-1", State: "running", Status: "Up 2 hours", Publishers: [
        { PublishedPort: 10999, TargetPort: 10999, Protocol: "udp" },
        { PublishedPort: 11000, TargetPort: 11000, Protocol: "udp" }
      ] },
      { Service: "admin-web", State: "running", Status: "Up", Publishers: null }
    ]);
    expect(parseComposeStatus(output)).toEqual({
      overall: "running",
      containers: [{ name: "dst-server", state: "running", status: "Up 2 hours", ports: ["10999:10999/udp", "11000:11000/udp"] }]
    });
  });

  it.each(["dst-steam-admin_dst-server_1", "dst-steam-admin-dst-server-1"])("recognizes %s without Service in newline-delimited JSON", (name) => {
    const output = [
      JSON.stringify({ Name: name, State: "exited", Status: "Exited", Publishers: null }),
      JSON.stringify({ Service: "admin-api", State: "running" })
    ].join("\n");
    expect(parseComposeStatus(output)).toEqual({
      overall: "stopped", containers: [{ name: "dst-server", state: "exited", status: "Exited", ports: [] }]
    });
  });

  it("keeps a restarting container out of the stopped state", () => {
    expect(parseComposeStatus(JSON.stringify([{ Service: "dst-server", State: "restarting" }])).overall).toBe("starting");
  });

  it("reports a missing combined container as stopped", () => {
    expect(parseComposeStatus("[]")).toEqual({ overall: "stopped", containers: [] });
  });
});

describe("isServerReady", () => {
  it("is not ready while the current run has started but no readiness marker yet", () => {
    const logs = [
      "dst-server-1  | Starting DST shard Master on UDP 10999",
      "dst-server-1  | [Master] [00:00:00]: loaded modindex",
      "dst-server-1  | [Master] [00:00:12]: Loading mod: workshop-1"
    ].join("\n");

    expect(isServerReady(logs)).toBe(false);
  });

  it("is ready once a readiness marker appears after the current run's start marker", () => {
    const logs = [
      "dst-server-1  | Starting DST shard Master on UDP 10999",
      "dst-server-1  | [Master] [00:06:08]: [Shard] Starting master server",
      "dst-server-1  | [Master] [00:06:59]: Server registered via geo DNS in ap-southeast-1"
    ].join("\n");

    expect(isServerReady(logs)).toBe(true);
  });

  it("ignores readiness markers from a previous run kept across docker restart", () => {
    const logs = [
      "dst-server-1  | Starting DST shard Master on UDP 10999",
      "dst-server-1  | [Master] [00:06:59]: Server registered via geo DNS in ap-southeast-1",
      "dst-server-1  | [Master] [99:99:99]: Sim paused",
      // restart keeps the lines above; the new run has only just begun:
      "dst-server-1  | Starting DST shard Master on UDP 10999",
      "dst-server-1  | [Master] [00:00:00]: loaded modindex"
    ].join("\n");

    expect(isServerReady(logs)).toBe(false);
  });

  it("treats a run as ready once its start marker has scrolled out of the log window", () => {
    const logs = [
      "dst-server-1  | [Master] [12:00:00]: some long-running steady-state log",
      "dst-server-1  | [Caves] [12:00:01]: another line"
    ].join("\n");

    expect(isServerReady(logs)).toBe(true);
  });

  it("does not treat caves readiness as master readiness in shared logs", () => {
    expect(isServerReady("Starting DST shard Master\n[Caves] Sim paused\n[Master] loading world")).toBe(false);
    expect(isServerReady("Starting DST shard Master\n[Master] Server registered via geo DNS")).toBe(true);
  });

  it("supports custom readiness markers", () => {
    const logs = [
      "dst-server-1  | Starting DST shard Master on UDP 10999",
      "dst-server-1  | [Master] [00:05:00]: world ready for players"
    ].join("\n");

    expect(isServerReady(logs)).toBe(false);
    expect(isServerReady(logs, ["world ready for players"])).toBe(true);
  });
});
