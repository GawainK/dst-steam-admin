export interface ContainerStatus {
  name: "dst-master" | "dst-caves";
  state: string;
  status: string;
  ports: string[];
}

export interface ServerStatus {
  overall: "running" | "starting" | "stopped" | "partial";
  containers: ContainerStatus[];
}

// The entrypoint prints this once per (re)start, before launching the game binary, so
// it anchors "the current run" inside logs that `docker compose restart` keeps from
// previous runs. We only trust readiness markers that appear after the latest one.
export const MASTER_START_MARKER = "Starting DST shard Master";

// Lines DST logs once the master shard has finished loading and is serving players.
// Override via env (DST_READY_MARKERS) when a deployment's logs use different phrasing.
export const READY_MARKERS = ["registered via geo DNS", "Sim paused"];

// Decides whether the master game process (not just the container) is ready, by reading
// recent combined compose logs. If the current run's start marker is still visible, the
// server is only ready once a readiness marker appears after it; if the start marker has
// already scrolled out of the log window, the run began long ago and counts as ready.
export function isServerReady(
  logs: string,
  markers: readonly string[] = READY_MARKERS
): boolean {
  const boundary = logs.lastIndexOf(MASTER_START_MARKER);
  if (boundary < 0) {
    return true;
  }

  const currentRun = logs.slice(boundary);
  return markers.some((marker) => currentRun.includes(marker));
}

interface ComposePublisher {
  PublishedPort?: number;
  TargetPort?: number;
  Protocol?: string;
}

interface ComposeStatusEntry {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Publishers?: ComposePublisher[] | null;
}

const TARGET_CONTAINERS = ["dst-master", "dst-caves"] as const;
const TARGET_SET = new Set<string>(TARGET_CONTAINERS);

function normalizeContainerName(entry: ComposeStatusEntry): ContainerStatus["name"] | null {
  if (entry.Service && TARGET_SET.has(entry.Service)) {
    return entry.Service as ContainerStatus["name"];
  }

  if (!entry.Name) {
    return null;
  }

  for (const target of TARGET_CONTAINERS) {
    if (
      entry.Name === target ||
      entry.Name.endsWith(`-${target}-1`) ||
      entry.Name.endsWith(`_${target}_1`)
    ) {
      return target;
    }
  }

  return null;
}

function formatPublisher(publisher: ComposePublisher): string | null {
  if (
    typeof publisher.PublishedPort !== "number" ||
    typeof publisher.TargetPort !== "number" ||
    typeof publisher.Protocol !== "string"
  ) {
    return null;
  }

  return `${publisher.PublishedPort}:${publisher.TargetPort}/${publisher.Protocol}`;
}

function resolveOverall(containers: ContainerStatus[]): ServerStatus["overall"] {
  const runningCount = containers.filter(
    (container) => container.state.toLowerCase() === "running"
  ).length;

  if (runningCount === TARGET_CONTAINERS.length && containers.length === TARGET_CONTAINERS.length) {
    return "running";
  }

  if (runningCount === 0) {
    return "stopped";
  }

  return "partial";
}

export function parseComposeStatus(output: string): ServerStatus {
  const trimmedOutput = output.trim();
  const containers = (trimmedOutput.startsWith("[")
    ? (JSON.parse(trimmedOutput) as ComposeStatusEntry[])
    : trimmedOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ComposeStatusEntry))
    .map((entry) => {
      const name = normalizeContainerName(entry);

      if (!name) {
        return null;
      }

      return {
        name,
        state: entry.State ?? "unknown",
        status: entry.Status ?? "",
        ports: (entry.Publishers ?? [])
          .map((publisher) => formatPublisher(publisher))
          .filter((port): port is string => port !== null)
      } satisfies ContainerStatus;
    })
    .filter((container): container is ContainerStatus => container !== null)
    .sort(
      (left, right) =>
        TARGET_CONTAINERS.indexOf(left.name) - TARGET_CONTAINERS.indexOf(right.name)
    );

  return {
    overall: resolveOverall(containers),
    containers
  };
}
