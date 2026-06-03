import { describe, expect, it } from "vitest";

import { addMod, normalizeModId, parseOverrides, parseSetup, removeMod, setEnabled } from "../src/config/mods-parser.js";

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

describe("增删改", () => {
  const files = {
    setup: 'ServerModSetup("111")\nServerModSetup("222")\n',
    overrides: `return {
  ["workshop-111"]={ enabled=true },
  ["workshop-222"]={ enabled=false, configuration_options={ ["k"]="v" } }
}
`
  };

  it("addMod 同时写入 setup 与 overrides，默认启用，幂等", () => {
    const next = addMod(files, "333");
    expect(parseSetup(next.setup)).toEqual(["111", "222", "333"]);
    const entry = parseOverrides(next.overrides).find((e) => e.id === "333");
    expect(entry?.enabled).toBe(true);
    // 幂等：再次添加不重复
    const again = addMod(next, "333");
    expect(parseSetup(again.setup)).toEqual(["111", "222", "333"]);
    expect(parseOverrides(again.overrides).filter((e) => e.id === "333")).toHaveLength(1);
  });

  it("removeMod 从两个文件移除，保留其他模组的内层配置", () => {
    const next = removeMod(files, "111");
    expect(parseSetup(next.setup)).toEqual(["222"]);
    const entries = parseOverrides(next.overrides);
    expect(entries.map((e) => e.id)).toEqual(["222"]);
    expect(next.overrides).toContain('["k"]="v"');
  });

  it("setEnabled 只翻转目标模组的 enabled，不丢配置", () => {
    const next = setEnabled(files, "222", true);
    const entry = parseOverrides(next.overrides).find((e) => e.id === "222");
    expect(entry?.enabled).toBe(true);
    expect(next.overrides).toContain('["k"]="v"');
    // 其他模组不受影响
    expect(parseOverrides(next.overrides).find((e) => e.id === "111")?.enabled).toBe(true);
  });

  it("setEnabled 对无 enabled 字段但含 configuration_options 的条目注入正确，不损坏嵌套配置", () => {
    const filesNoEnabled = {
      setup: 'ServerModSetup("444")\n',
      overrides: `return {
  ["workshop-444"]={ configuration_options={ ["speed"]=2 } }
}
`
    };
    const next = setEnabled(filesNoEnabled, "444", true);
    expect(parseOverrides(next.overrides).find((e) => e.id === "444")?.enabled).toBe(true);
    expect(next.overrides).toContain('["speed"]=2');
  });
});
