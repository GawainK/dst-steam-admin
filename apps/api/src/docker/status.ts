export interface ContainerStatus {
  name: "dst-master" | "dst-caves";
  state: string;
  status: string;
  ports: string[];
}

export interface ServerStatus {
  overall: "running" | "stopped" | "partial";
  containers: ContainerStatus[];
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
