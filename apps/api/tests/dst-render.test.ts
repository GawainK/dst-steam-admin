import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "../..");

describe("dst render config script", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders shard config, token file, and mod files from mounted data", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "dst-render-"));
    const clusterRoot = resolve(root, "cluster");
    const modsRoot = resolve(root, "mods");
    const installRoot = resolve(root, "install");
    tempRoots.push(root);

    mkdirSync(resolve(installRoot, "mods"), { recursive: true });
    mkdirSync(modsRoot, { recursive: true });

    writeFileSync(resolve(modsRoot, "dedicated_server_mods_setup.lua"), "ServerModSetup('workshop-1')\n");
    writeFileSync(resolve(modsRoot, "modoverrides.lua"), "return { enabled = true }\n");

    await execFileAsync("sh", ["docker/dst/render-config.sh"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DST_CLUSTER_ROOT: clusterRoot,
        DST_MODS_ROOT: modsRoot,
        DST_INSTALL_ROOT: installRoot,
        DST_TEMPLATE_ROOT: resolve(repoRoot, "docker/dst"),
        DST_SHARD: "Master",
        DST_CLUSTER_NAME: "Shard Test",
        DST_CLUSTER_PASSWORD: "pwd123",
        DST_GAME_MODE: "endless",
        DST_MAX_PLAYERS: "8",
        DST_SERVER_PORT: "10999",
        DST_STEAM_TOKEN: "steam-token-value"
      }
    });

    expect(readFileSync(resolve(clusterRoot, "cluster.ini"), "utf8")).toContain(
      "cluster_name = Shard Test"
    );
    expect(readFileSync(resolve(clusterRoot, "cluster.ini"), "utf8")).toContain(
      "game_mode = endless"
    );
    expect(
      readFileSync(resolve(clusterRoot, "Master/server.ini"), "utf8")
    ).toContain("server_port = 10999");
    expect(
      readFileSync(resolve(clusterRoot, "cluster_token.txt"), "utf8")
    ).toBe("steam-token-value\n");
    expect(
      readFileSync(resolve(clusterRoot, "Master/modoverrides.lua"), "utf8")
    ).toBe("return { enabled = true }\n");
    expect(
      readFileSync(resolve(installRoot, "mods/dedicated_server_mods_setup.lua"), "utf8")
    ).toBe("ServerModSetup('workshop-1')\n");
  });

  it("falls back to admin server-config.json when env values are unset", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "dst-render-config-file-"));
    const clusterRoot = resolve(root, "cluster");
    const modsRoot = resolve(root, "mods");
    const installRoot = resolve(root, "install");
    tempRoots.push(root);

    mkdirSync(resolve(clusterRoot, "admin"), { recursive: true });
    mkdirSync(resolve(installRoot, "mods"), { recursive: true });
    mkdirSync(modsRoot, { recursive: true });

    writeFileSync(
      resolve(clusterRoot, "admin/server-config.json"),
      JSON.stringify(
        {
          steamToken: "config-token",
          clusterName: "Config Driven Cluster",
          clusterPassword: "cfg-pass",
          maxPlayers: 10,
          gameMode: "wilderness",
          enableCaves: true,
          masterPort: 12345,
          cavesPort: 12346
        },
        null,
        2
      )
    );

    await execFileAsync("sh", ["docker/dst/render-config.sh"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DST_CLUSTER_ROOT: clusterRoot,
        DST_MODS_ROOT: modsRoot,
        DST_INSTALL_ROOT: installRoot,
        DST_TEMPLATE_ROOT: resolve(repoRoot, "docker/dst"),
        DST_SHARD: "Master"
      }
    });

    expect(readFileSync(resolve(clusterRoot, "cluster.ini"), "utf8")).toContain(
      "cluster_name = Config Driven Cluster"
    );
    expect(readFileSync(resolve(clusterRoot, "cluster.ini"), "utf8")).toContain(
      "max_players = 10"
    );
    expect(
      readFileSync(resolve(clusterRoot, "Master/server.ini"), "utf8")
    ).toContain("server_port = 12345");
    expect(
      readFileSync(resolve(clusterRoot, "cluster_token.txt"), "utf8")
    ).toBe("config-token\n");
  });
});
