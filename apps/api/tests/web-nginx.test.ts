import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("web nginx deployment config", () => {
  it("proxies /api requests to the admin-api service", () => {
    const configPath = resolve(repoRoot, "docker/web.nginx.conf");
    const config = readFileSync(configPath, "utf8");

    expect(config).toContain("location /api/");
    expect(config).toContain("proxy_pass http://admin-api:3000;");
  });
});
