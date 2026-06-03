import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveModNames } from "../src/config/mod-names.js";

describe("resolveModNames", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot() {
    const root = mkdtempSync(resolve(tmpdir(), "dst-names-"));
    roots.push(root);
    return root;
  }

  function fakeFetch(titles: Record<string, string>) {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          publishedfiledetails: Object.entries(titles).map(([id, title]) => ({
            publishedfileid: id,
            title
          }))
        }
      })
    })) as unknown as typeof fetch;
  }

  it("解析名称并写入磁盘缓存", async () => {
    const root = tempRoot();
    const fetchImpl = fakeFetch({ "111": "Global Positions" });
    const names = await resolveModNames(root, ["111"], fetchImpl);
    expect(names).toEqual({ "111": "Global Positions" });
    const cache = JSON.parse(
      readFileSync(resolve(root, "data/mods/.mod-names.json"), "utf8")
    );
    expect(cache["111"]).toBe("Global Positions");
  });

  it("命中缓存时不再请求 Steam", async () => {
    const root = tempRoot();
    const first = fakeFetch({ "111": "Global Positions" });
    await resolveModNames(root, ["111"], first);
    const second = fakeFetch({ "111": "SHOULD NOT BE USED" });
    const names = await resolveModNames(root, ["111"], second);
    expect(second).not.toHaveBeenCalled();
    expect(names["111"]).toBe("Global Positions");
  });

  it("Steam 请求失败时降级为 null，不抛错", async () => {
    const root = tempRoot();
    const failing = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const names = await resolveModNames(root, ["999"], failing);
    expect(names).toEqual({ "999": null });
  });
});
