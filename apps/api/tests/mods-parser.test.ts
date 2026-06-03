import { describe, expect, it } from "vitest";

import { normalizeModId, parseOverrides, parseSetup } from "../src/config/mods-parser.js";

describe("parseSetup", () => {
  it("提取纯数字 ID，并容忍 workshop- 前缀与单双引号", () => {
    const text = [
      "-- comment",
      'ServerModSetup("378160973")',
      "ServerModSetup('workshop-123456')",
      ""
    ].join("\n");
    expect(parseSetup(text)).toEqual(["378160973", "123456"]);
  });

  it("空内容返回空数组", () => {
    expect(parseSetup("")).toEqual([]);
  });
});

describe("normalizeModId", () => {
  it("去掉 workshop- 前缀，非法输入返回 null", () => {
    expect(normalizeModId("workshop-42")).toBe("42");
    expect(normalizeModId("  99 ")).toBe("99");
    expect(normalizeModId("abc")).toBeNull();
    expect(normalizeModId(undefined)).toBeNull();
  });
});

describe("parseOverrides", () => {
  const sample = `return {
  ["workshop-378160973"]={ enabled=true },
  ["workshop-123456"]={
    enabled=false,
    configuration_options={ ["difficulty"]="hard", ["nested"]={ a=1 } }
  }
}
`;

  it("提取每个模组的 id / enabled，并原样保留块文本", () => {
    const entries = parseOverrides(sample);
    expect(entries.map((e) => e.id)).toEqual(["378160973", "123456"]);
    expect(entries.map((e) => e.enabled)).toEqual([true, false]);
    expect(entries[1].raw).toContain('["difficulty"]="hard"');
    expect(entries[1].raw).toContain("nested");
  });

  it("空表返回空数组", () => {
    expect(parseOverrides("return {}\n")).toEqual([]);
  });

  it("根表花括号不匹配时抛 ModParseError", () => {
    expect(() => parseOverrides("return {")).toThrow(/花括号|根表/);
  });
});
