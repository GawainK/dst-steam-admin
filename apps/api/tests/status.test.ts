import { describe, expect, it } from "vitest";

import { isServerReady, parseComposeStatus } from "../src/docker/status.js";

describe("parseComposeStatus", () => {
  it("parses compose json array output and keeps dst containers only", () => {
    const output = JSON.stringify([
      {
        Name: "dst-steam-admin-dst-master-1",
        Service: "dst-master",
        State: "running",
        Status: "Up 2 hours",
        Publishers: [
          {
            PublishedPort: 10999,
            TargetPort: 10999,
            Protocol: "udp"
          }
        ]
      },
      {
        Name: "dst-steam-admin-dst-caves-1",
        Service: "dst-caves",
        State: "exited",
        Status: "Exited (1) 10 seconds ago",
        Publishers: null
      },
      {
        Name: "dst-steam-admin-admin-web-1",
        Service: "admin-web",
        State: "running",
        Status: "Up 2 hours",
        Publishers: [
          {
            PublishedPort: 8080,
            TargetPort: 8080,
            Protocol: "tcp"
          }
        ]
      }
    ]);

    expect(parseComposeStatus(output)).toEqual({
      overall: "partial",
      containers: [
        {
          name: "dst-master",
          state: "running",
          status: "Up 2 hours",
          ports: ["10999:10999/udp"]
        },
        {
          name: "dst-caves",
          state: "exited",
          status: "Exited (1) 10 seconds ago",
          ports: []
        }
      ]
    });
  });

  it("parses newline-delimited compose json output", () => {
    const output = [
      JSON.stringify({
        Name: "dst-steam-admin_dst-caves_1",
        State: "running",
        Status: "Up 5 minutes",
        Publishers: null
      }),
      JSON.stringify({
        Name: "dst-steam-admin_dst-master_1",
        State: "running",
        Status: "Up 5 minutes",
        Publishers: [
          {
            PublishedPort: 10999,
            TargetPort: 10999,
            Protocol: "udp"
          }
        ]
      }),
      JSON.stringify({
        Name: "dst-steam-admin_admin-web_1",
        State: "running",
        Status: "Up 5 minutes",
        Publishers: null
      })
    ].join("\n");

    expect(parseComposeStatus(output)).toEqual({
      overall: "running",
      containers: [
        {
          name: "dst-master",
          state: "running",
          status: "Up 5 minutes",
          ports: ["10999:10999/udp"]
        },
        {
          name: "dst-caves",
          state: "running",
          status: "Up 5 minutes",
          ports: []
        }
      ]
    });
  });
});

describe("isServerReady", () => {
  it("is not ready while the current run has started but no readiness marker yet", () => {
    const logs = [
      "dst-master-1  | Starting DST shard Master on UDP 10999",
      "dst-master-1  | [00:00:00]: loaded modindex",
      "dst-master-1  | [00:00:12]: Loading mod: workshop-1"
    ].join("\n");

    expect(isServerReady(logs)).toBe(false);
  });

  it("is ready once a readiness marker appears after the current run's start marker", () => {
    const logs = [
      "dst-master-1  | Starting DST shard Master on UDP 10999",
      "dst-master-1  | [00:06:08]: [Shard] Starting master server",
      "dst-master-1  | [00:06:59]: Server registered via geo DNS in ap-southeast-1"
    ].join("\n");

    expect(isServerReady(logs)).toBe(true);
  });

  it("ignores readiness markers from a previous run kept across docker restart", () => {
    const logs = [
      "dst-master-1  | Starting DST shard Master on UDP 10999",
      "dst-master-1  | [00:06:59]: Server registered via geo DNS in ap-southeast-1",
      "dst-master-1  | [99:99:99]: Sim paused",
      // restart keeps the lines above; the new run has only just begun:
      "dst-master-1  | Starting DST shard Master on UDP 10999",
      "dst-master-1  | [00:00:00]: loaded modindex"
    ].join("\n");

    expect(isServerReady(logs)).toBe(false);
  });

  it("treats a run as ready once its start marker has scrolled out of the log window", () => {
    const logs = [
      "dst-master-1  | [12:00:00]: some long-running steady-state log",
      "dst-caves-1  | [12:00:01]: another line"
    ].join("\n");

    expect(isServerReady(logs)).toBe(true);
  });

  it("supports custom readiness markers", () => {
    const logs = [
      "dst-master-1  | Starting DST shard Master on UDP 10999",
      "dst-master-1  | [00:05:00]: world ready for players"
    ].join("\n");

    expect(isServerReady(logs)).toBe(false);
    expect(isServerReady(logs, ["world ready for players"])).toBe(true);
  });
});
