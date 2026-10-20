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

    // Both shards share the container network and connect over loopback.
    const masterClusterIni = readFileSync(resolve(clusterDir, "cluster.ini"), "utf8");
    expect(masterClusterIni).toContain("[SHARD]");
    expect(masterClusterIni).toContain("shard_enabled = true");
    expect(masterClusterIni).toContain("bind_ip = 0.0.0.0");
    expect(masterClusterIni).toContain("master_ip = 127.0.0.1");
    expect(masterClusterIni).toContain("master_port = 10888");
    expect(masterClusterIni).toContain("cluster_key = dst-steam-admin-shard");

    const masterServerIni = readFileSync(
      resolve(clusterDir, "Master/server.ini"),
      "utf8"
    );
    expect(masterServerIni).toContain("is_master = true");
    expect(masterServerIni).toContain("name = Master");
    expect(masterServerIni).toContain("[STEAM]");
    expect(masterServerIni).toContain("authentication_port = 8766");
    expect(masterServerIni).toContain("master_server_port = 27016");
    // The master shard must not declare an id.
    expect(masterServerIni).not.toContain("id =");

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

  it("points caves at the local master and gives it a unique id", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "dst-render-caves-"));
    const clusterRoot = resolve(root, "cluster");
    const modsRoot = resolve(root, "mods");
    const installRoot = resolve(root, "install");
    tempRoots.push(root);

    mkdirSync(resolve(installRoot, "mods"), { recursive: true });
    mkdirSync(modsRoot, { recursive: true });

    await execFileAsync("sh", ["docker/dst/render-config.sh"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DST_CLUSTER_ROOT: clusterRoot,
        DST_MODS_ROOT: modsRoot,
        DST_INSTALL_ROOT: installRoot,
        DST_TEMPLATE_ROOT: resolve(repoRoot, "docker/dst"),
        DST_SHARD: "Caves"
      }
    });

    const clusterDir = resolve(clusterRoot, "DoNotStarveTogether/Cluster");

    // Caves reaches Master inside the same container.
    const cavesClusterIni = readFileSync(resolve(clusterDir, "cluster.ini"), "utf8");
    expect(cavesClusterIni).toContain("shard_enabled = true");
    expect(cavesClusterIni).toContain("master_ip = 127.0.0.1");
    expect(cavesClusterIni).toContain("master_port = 10888");
    expect(cavesClusterIni).toContain("cluster_key = dst-steam-admin-shard");

    const cavesServerIni = readFileSync(
      resolve(clusterDir, "Caves/server.ini"),
      "utf8"
    );
    expect(cavesServerIni).toContain("server_port = 11000");
    expect(cavesServerIni).toContain("is_master = false");
    expect(cavesServerIni).toContain("name = Caves");
    expect(cavesServerIni).toContain("authentication_port = 8767");
    expect(cavesServerIni).toContain("master_server_port = 27017");
    expect(cavesServerIni).toContain("id = 2");
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

  it("only downloads DST when the installed buildid differs from the latest", async () => {
    const installScript = readFileSync(
      resolve(repoRoot, "docker/dst/install-server.sh"),
      "utf8"
    );

    // Reads the installed buildid from the app manifest and the latest from Steam,
    // then short-circuits the download when they match.
    expect(installScript).toContain("appmanifest_${app_id}.acf");
    expect(installScript).toContain("app_info_print");
    expect(installScript).toContain("installed_buildid");
    expect(installScript).toContain("latest_buildid");
    expect(installScript).toContain("skipping update");
  });

  it("shares the existing master install for both shards in one container", async () => {
    const compose = readFileSync(resolve(repoRoot, "docker-compose.yml"), "utf8");

    expect(compose).toContain("./data/install/master:/opt/dst");
    expect(compose).not.toContain("./data/install/caves:/opt/dst");
    expect(compose).toContain("  dst-server:");
    expect(compose).not.toContain("  dst-caves:");
    expect(compose).toContain("11000:11000/udp");
  });

  it("shares one persisted SteamCMD directory", async () => {
    const compose = readFileSync(resolve(repoRoot, "docker-compose.yml"), "utf8");

    expect(compose).toContain("./data/steamcmd/master:/opt/steamcmd");
    expect(compose).not.toContain("./data/steamcmd/caves:/opt/steamcmd");
  });

  it("pins a fixed compose project name so admin-api and the host CLI agree", async () => {
    const compose = readFileSync(resolve(repoRoot, "docker-compose.yml"), "utf8");

    // Without a fixed name the project defaults to the cwd basename, so admin-api
    // (/app) and the CLI (dst-steam-admin) target different projects and the UI
    // reports the server as stopped while it is actually running.
    expect(compose).toMatch(/^name:\s*dst-steam-admin\s*$/m);
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
