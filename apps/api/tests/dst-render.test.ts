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

    // DST resolves <persistent_storage_root>/<conf_dir>/<cluster>; rendered files must
    // live there, not flat under clusterRoot, or the server can't find the token file.
    const clusterDir = resolve(clusterRoot, "DoNotStarveTogether/Cluster");
    expect(readFileSync(resolve(clusterDir, "cluster.ini"), "utf8")).toContain(
      "cluster_name = Shard Test"
    );
    expect(readFileSync(resolve(clusterDir, "cluster.ini"), "utf8")).toContain(
      "game_mode = endless"
    );
    expect(
      readFileSync(resolve(clusterDir, "Master/server.ini"), "utf8")
    ).toContain("server_port = 10999");
    expect(
      readFileSync(resolve(clusterDir, "cluster_token.txt"), "utf8")
    ).toBe("steam-token-value\n");
    expect(
      readFileSync(resolve(clusterDir, "Master/modoverrides.lua"), "utf8")
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

    const clusterDir = resolve(clusterRoot, "DoNotStarveTogether/Cluster");
    expect(readFileSync(resolve(clusterDir, "cluster.ini"), "utf8")).toContain(
      "cluster_name = Config Driven Cluster"
    );
    expect(readFileSync(resolve(clusterDir, "cluster.ini"), "utf8")).toContain(
      "max_players = 10"
    );
    expect(
      readFileSync(resolve(clusterDir, "Master/server.ini"), "utf8")
    ).toContain("server_port = 12345");
    expect(
      readFileSync(resolve(clusterDir, "cluster_token.txt"), "utf8")
    ).toBe("config-token\n");
  });

  it("entrypoint uses the installed bin64 dedicated server executable", async () => {
    const entrypoint = readFileSync(
      resolve(repoRoot, "docker/dst/entrypoint.sh"),
      "utf8"
    );

    expect(entrypoint).toContain(
      '${install_root}/bin64/dontstarve_dedicated_server_nullrenderer_x64'
    );
    expect(entrypoint).not.toContain(
      '${install_root}/bin/dontstarve_dedicated_server_nullrenderer_x64'
    );
  });

  it("launches the dedicated server from the bin64 working directory", async () => {
    const entrypoint = readFileSync(
      resolve(repoRoot, "docker/dst/entrypoint.sh"),
      "utf8"
    );

    // Game data is resolved relative to cwd; launching elsewhere breaks main.lua.
    expect(entrypoint).toContain('cd "${install_root}/bin64"');
  });

  it("passes relative -conf_dir/-cluster segments so DST does not build a doubled path", async () => {
    const entrypoint = readFileSync(
      resolve(repoRoot, "docker/dst/entrypoint.sh"),
      "utf8"
    );

    // Passing an absolute -conf_dir equal to the storage root makes DST concatenate
    // it into /var/lib/dst/cluster//var/lib/dst/cluster/... and lose the token file.
    expect(entrypoint).not.toContain('-conf_dir "${cluster_root}"');
    expect(entrypoint).toContain('-conf_dir "${conf_dir_name}"');
    expect(entrypoint).toContain('-cluster "${cluster_dir_name}"');
  });

  it("retries SteamCMD app updates instead of failing after a single transient error", async () => {
    const installScript = readFileSync(
      resolve(repoRoot, "docker/dst/install-server.sh"),
      "utf8"
    );

    expect(installScript).toContain('install_retry_count="${DST_INSTALL_RETRY_COUNT:-3}"');
    expect(installScript).toContain("while [");
    expect(installScript).toContain("sleep");
  });

  it("persists per-shard install directories in docker compose", async () => {
    const compose = readFileSync(resolve(repoRoot, "docker-compose.yml"), "utf8");

    expect(compose).toContain("./data/install/master:/opt/dst");
    expect(compose).toContain("./data/install/caves:/opt/dst");
  });

  it("stores ini templates outside the persisted /opt/dst install volume", async () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, "docker/dst/Dockerfile"),
      "utf8"
    );
    const renderScript = readFileSync(
      resolve(repoRoot, "docker/dst/render-config.sh"),
      "utf8"
    );

    // The install volume mounts over /opt/dst, so templates baked into the image
    // must live outside it or they get shadowed at runtime.
    expect(dockerfile).not.toContain("/opt/dst/templates");
    expect(dockerfile).toContain("/opt/dst-templates/cluster.ini.template");
    expect(renderScript).toContain(
      'template_root="${DST_TEMPLATE_ROOT:-/opt/dst-templates}"'
    );
  });

  it("installs the libcurl-gnutls runtime the dedicated server binary links against", async () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, "docker/dst/Dockerfile"),
      "utf8"
    );

    // dontstarve_dedicated_server_nullrenderer_x64 needs libcurl-gnutls.so.4,
    // provided by libcurl3-gnutls (distinct from libcurl4's libcurl.so.4).
    expect(dockerfile).toContain("libcurl3-gnutls");
  });
});
