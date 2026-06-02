import { describe, expect, it } from "vitest";

import { parseComposeStatus } from "../src/docker/status.js";

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
