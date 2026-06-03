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

export interface OverrideEntry {
  id: string;
  enabled: boolean;
  raw: string;
}

const KEY_RE = /\[\s*["'](?:workshop-)?(\d+)["']\s*\]\s*=/;

// 返回根表 `{ ... }` 内部的内容（不含最外层花括号）。简单按花括号深度匹配，
// 不解析字符串内的花括号——DST 生成的配置不会出现，复杂情况由高级原文编辑兜底。
function rootTableBody(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new ModParseError("找不到 modoverrides 的根表");
  }
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start + 1, i);
      }
    }
  }
  throw new ModParseError("modoverrides 根表花括号不匹配");
}

// 按深度为 0 的逗号切分顶层条目。
function splitTopLevel(body: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      if (current.trim()) segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
}

export function parseOverrides(text: string): OverrideEntry[] {
  const body = rootTableBody(text);
  const entries: OverrideEntry[] = [];
  for (const segment of splitTopLevel(body)) {
    const keyMatch = segment.match(KEY_RE);
    if (!keyMatch) continue;
    entries.push({
      id: keyMatch[1],
      enabled: /enabled\s*=\s*true/.test(segment),
      raw: segment.trim()
    });
  }
  return entries;
}

export interface ModFiles {
  setup: string;
  overrides: string;
}

function setupHasId(setup: string, id: string): boolean {
  return parseSetup(setup).includes(id);
}

function addSetupLine(setup: string, id: string): string {
  if (setupHasId(setup, id)) return setup;
  const line = `ServerModSetup("${id}")\n`;
  if (setup === "" || setup.endsWith("\n")) return setup + line;
  return `${setup}\n${line}`;
}

function removeSetupLine(setup: string, id: string): string {
  const kept = setup
    .split("\n")
    .filter((rawLine) => {
      const match = rawLine.match(/ServerModSetup\(\s*["'](?:workshop-)?(\d+)["']\s*\)/);
      return !(match && match[1] === id);
    });
  return kept.join("\n");
}

function serializeOverrides(entries: OverrideEntry[]): string {
  if (entries.length === 0) return "return {}\n";
  const body = entries.map((entry) => `  ${entry.raw},`).join("\n");
  return `return {\n${body}\n}\n`;
}

function buildEntryRaw(id: string, enabled: boolean): string {
  return `["workshop-${id}"]={ enabled=${enabled} }`;
}

function setEnabledInRaw(raw: string, enabled: boolean): string {
  if (/enabled\s*=\s*(true|false)/.test(raw)) {
    return raw.replace(/enabled\s*=\s*(true|false)/, `enabled=${enabled}`);
  }
  // 匹配条目自身的值表起始 `]={`，避免误匹配嵌套的 configuration_options={
  return raw.replace(/(\]\s*=\s*\{)/, `$1 enabled=${enabled},`);
}

export function addMod(files: ModFiles, id: string): ModFiles {
  const entries = parseOverrides(files.overrides);
  const nextEntries = entries.some((entry) => entry.id === id)
    ? entries
    : [...entries, { id, enabled: true, raw: buildEntryRaw(id, true) }];
  return {
    setup: addSetupLine(files.setup, id),
    overrides: serializeOverrides(nextEntries)
  };
}

export function removeMod(files: ModFiles, id: string): ModFiles {
  const entries = parseOverrides(files.overrides).filter((entry) => entry.id !== id);
  return {
    setup: removeSetupLine(files.setup, id),
    overrides: serializeOverrides(entries)
  };
}

export function setEnabled(files: ModFiles, id: string, enabled: boolean): ModFiles {
  const entries = parseOverrides(files.overrides).map((entry) =>
    entry.id === id
      ? { ...entry, enabled, raw: setEnabledInRaw(entry.raw, enabled) }
      : entry
  );
  return {
    setup: files.setup,
    overrides: serializeOverrides(entries)
  };
}
