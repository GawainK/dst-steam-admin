export class ModParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModParseError";
  }
}

const SETUP_RE = /ServerModSetup\(\s*["'](?:workshop-)?(\d+)["']\s*\)/g;

export function parseSetup(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(SETUP_RE)) {
    ids.push(match[1]);
  }
  return ids;
}

export function normalizeModId(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") {
    return null;
  }
  const trimmed = String(input).trim().replace(/^workshop-/, "");
  return /^\d+$/.test(trimmed) ? trimmed : null;
}
