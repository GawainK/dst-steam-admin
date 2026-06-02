import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("api docker image", () => {
  it("installs docker cli support for compose commands", () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, "docker/api.Dockerfile"),
      "utf8"
    );

    expect(dockerfile).toContain("docker-ce-cli");
    expect(dockerfile).toContain("docker-compose-plugin");
  });
});
