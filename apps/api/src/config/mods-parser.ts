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
