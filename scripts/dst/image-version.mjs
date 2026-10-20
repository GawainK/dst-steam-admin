import { appendFile, readFile } from "node:fs/promises";

try {
  let info;
  if (process.env.DST_VERSION_INFO_FILE) {
    info = JSON.parse(await readFile(process.env.DST_VERSION_INFO_FILE, "utf8"));
  } else {
    // Metadata only; no Steam credentials or game download are needed here.
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch("https://api.steamcmd.net/v1/info/343050", {
          signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error(`Steam metadata HTTP ${response.status}`);
        info = await response.json();
        break;
      } catch (cause) {
        error = cause;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (!info) throw error;
  }
  const branch = info?.data?.["343050"]?.depots?.branches?.public;
  const buildId = String(branch?.buildid ?? "");
  const timeUpdated = String(branch?.timeupdated ?? "");
  if (info?.status !== "success" || !/^\d+$/.test(buildId) || !/^\d+$/.test(timeUpdated)) {
    throw new Error("Invalid public DST build metadata");
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `build_id=${buildId}\ntime_updated=${timeUpdated}\n`);
  }
  console.log(JSON.stringify({ buildId, timeUpdated }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
