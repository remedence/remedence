import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");

describe("single-host deployment contract", () => {
  const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
  const composeSource = readFileSync(
    resolve(root, "deploy/compose.yaml"),
    "utf8",
  );
  const compose = parse(composeSource) as {
    services: Record<string, Record<string, unknown>>;
  };

  it("requires immutable application and dependency image references", () => {
    expect(dockerfile).toContain("ARG BUN_BASE_IMAGE");
    expect(dockerfile).toContain("ARG NODE_BASE_IMAGE");
    expect(dockerfile).toContain("FROM ${BUN_BASE_IMAGE} AS build");
    expect(dockerfile).toContain("FROM ${NODE_BASE_IMAGE} AS runtime");
    expect(dockerfile).not.toMatch(/^FROM\s+\S+:latest/m);

    for (const variable of [
      "REMEDENCE_IMAGE",
      "REMEDENCE_CLAMAV_IMAGE",
      "REMEDENCE_CADDY_IMAGE",
    ]) {
      expect(composeSource).toContain(
        `\${${variable}:?Set ${variable} to an immutable image digest}`,
      );
    }
  });

  it("gates startup on configuration, migration, malware scanning, and health", () => {
    expect(Object.keys(compose.services)).toEqual(
      expect.arrayContaining([
        "preflight",
        "migrate",
        "api",
        "integration-worker",
        "privacy-worker",
        "verification-worker",
        "clamav",
        "edge",
      ]),
    );
    expect(compose.services.migrate.depends_on).toEqual({
      preflight: { condition: "service_completed_successfully" },
    });
    expect(compose.services.api.depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
      clamav: { condition: "service_healthy" },
    });
    expect(compose.services.edge.depends_on).toEqual({
      api: { condition: "service_healthy" },
    });
    expect(compose.services.api).not.toHaveProperty("ports");
    expect(compose.services.edge.ports).toEqual(["80:80", "443:443"]);
  });

  it("builds a non-root, locked, health-checked application image", () => {
    expect(dockerfile).toContain("bun install --frozen-lockfile");
    expect(dockerfile).toContain("RUN bun run build");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/readyz");
  });

  it("documents controlled promotion and restore-based rollback", () => {
    const guide = readFileSync(resolve(root, "deploy/README.md"), "utf8");
    expect(guide).toContain("## Controlled promotion");
    expect(guide).toContain("backup before every schema change");
    expect(guide).toContain("Promote in staging first");
    expect(guide).toContain("## Rollback");
    expect(guide).toContain("Schema rollback is restore-based");
  });
});
