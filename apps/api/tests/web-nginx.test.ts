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

  it("protects the UI and API with Basic Auth", () => {
    const config = readFileSync(
      resolve(repoRoot, "docker/web.nginx.conf"),
      "utf8"
    );

    expect(config).toContain('auth_basic "DST Admin";');
    expect(config).toContain("auth_basic_user_file /etc/nginx/.htpasswd;");
  });
});

describe("web docker image basic auth", () => {
  it("installs htpasswd and wires the basic-auth entrypoint script", () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, "docker/web.Dockerfile"),
      "utf8"
    );

    expect(dockerfile).toContain("apk add --no-cache apache2-utils");
    expect(dockerfile).toContain(
      "COPY docker/web-basic-auth.sh /docker-entrypoint.d/40-basic-auth.sh"
    );
  });

  it("fails fast when no password is configured", () => {
    const script = readFileSync(
      resolve(repoRoot, "docker/web-basic-auth.sh"),
      "utf8"
    );

    expect(script).toContain("BASIC_AUTH_PASSWORD");
    expect(script).toContain("exit 1");
    expect(script).toContain("htpasswd -bc /etc/nginx/.htpasswd");
  });
});
