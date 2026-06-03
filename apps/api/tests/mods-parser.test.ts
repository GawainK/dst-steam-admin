import { describe, expect, it } from "vitest";

import { normalizeModId, parseSetup } from "../src/config/mods-parser.js";

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
