import { describe, expect, it } from "vitest";
import {
  API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_DEV_ORIGIN,
  isProductionMode,
  resolveApiPort,
  resolveAuthenticationConfig,
  resolveDevelopmentOrigin,
  resolveEvidenceSecurityConfig,
  resolveWorkspaceMode,
} from "../src/config.js";

describe("local API configuration", () => {
  it("requires ClamAV and a manifest key for hosted evidence", () => {
    const authentication = {
      mode: "required" as const,
      baseURL: "https://remedence.example",
    };
    expect(() => resolveEvidenceSecurityConfig(authentication, {})).toThrow(
      "Hosted mode requires REMEDENCE_EVIDENCE_SIGNING_KEY",
    );
    expect(
      resolveEvidenceSecurityConfig(authentication, {
        signingKey: "e".repeat(32),
        scanner: "clamav",
        scannerHost: "clamav",
        scannerPort: "3310",
      }),
    ).toEqual({
      scanner: "clamav",
      signingKey: "e".repeat(32),
      host: "clamav",
      port: 3310,
    });
  });
  it("keeps the unauthenticated API on loopback", () => {
    expect(API_HOST).toBe("127.0.0.1");
  });

  it("uses the approved default port and accepts a bounded override", () => {
    expect(resolveApiPort(undefined)).toBe(DEFAULT_API_PORT);
    expect(resolveApiPort("5500")).toBe(5500);
  });

  it("starts empty unless demo data is explicitly requested", () => {
    expect(resolveWorkspaceMode(undefined)).toBe("empty");
    expect(resolveWorkspaceMode("demo")).toBe("demo");
    expect(() => resolveWorkspaceMode("automatic")).toThrow(
      'REMEDENCE_WORKSPACE_MODE must be either "empty" or "demo".',
    );
  });

  it("enables built web serving for explicit production mode or a package-manager start", () => {
    expect(isProductionMode("production", undefined)).toBe(true);
    expect(isProductionMode(undefined, "start")).toBe(true);
    expect(isProductionMode("development", "start")).toBe(true);
    expect(isProductionMode("production", "dev")).toBe(false);
    expect(isProductionMode(undefined, "dev")).toBe(false);
    expect(isProductionMode(undefined, undefined)).toBe(false);
  });

  it("allows only an explicit loopback HTTP development origin", () => {
    expect(resolveDevelopmentOrigin(undefined)).toBe(DEFAULT_DEV_ORIGIN);
    expect(resolveDevelopmentOrigin("http://127.0.0.1:43993")).toBe(
      "http://127.0.0.1:43993",
    );
    for (const value of [
      "https://127.0.0.1:43993",
      "http://localhost:43993",
      "http://0.0.0.0:43993",
      "http://127.0.0.1",
      "http://127.0.0.1:43993/path",
    ]) {
      expect(() => resolveDevelopmentOrigin(value)).toThrow(
        "REMEDENCE_DEV_ORIGIN must be an http://127.0.0.1 origin with a port.",
      );
    }
  });

  it.each(["80", "65536", "43180.5", "abc", ""])(
    "rejects invalid port value %j",
    (value) => {
      expect(() => resolveApiPort(value)).toThrow(
        "REMEDENCE_API_PORT must be an integer from 1024 through 65535.",
      );
    },
  );

  it("defaults to the loopback-only local authentication boundary", () => {
    expect(resolveAuthenticationConfig({})).toEqual({ mode: "local" });
  });

  it("requires secret material and an explicit origin for required authentication", () => {
    expect(() =>
      resolveAuthenticationConfig({
        mode: "required",
        baseURL: "https://remedence.example",
      }),
    ).toThrow(
      "BETTER_AUTH_SECRET or every BETTER_AUTH_SECRETS value must contain at least 32 characters when authentication is required.",
    );
    expect(() =>
      resolveAuthenticationConfig({
        mode: "required",
        secret: "a".repeat(32),
      }),
    ).toThrow(
      "BETTER_AUTH_URL must be an explicit HTTPS origin, or an HTTP 127.0.0.1 origin for local testing.",
    );
  });

  it("accepts HTTPS production and explicit loopback test origins", () => {
    expect(
      resolveAuthenticationConfig({
        mode: "required",
        baseURL: "https://remedence.example",
        secrets: `2:${"b".repeat(32)},1:${"a".repeat(32)}`,
        passwordResetWebhookURL: "https://mailer.example/reset",
        passwordResetWebhookToken: "c".repeat(32),
      }),
    ).toEqual({
      mode: "required",
      baseURL: "https://remedence.example",
      requireMfa: true,
      passwordResetDelivery: {
        webhookURL: "https://mailer.example/reset",
        bearerToken: "c".repeat(32),
      },
    });
    expect(
      resolveAuthenticationConfig({
        mode: "required",
        baseURL: "http://127.0.0.1:43180",
        secret: "a".repeat(32),
      }),
    ).toEqual({
      mode: "required",
      baseURL: "http://127.0.0.1:43180",
      requireMfa: false,
      passwordResetDelivery: null,
    });
  });

  it.each([
    { secret: "short" },
    { secrets: `2:${"a".repeat(31)}` },
    { secrets: `2:${"a".repeat(32)},2:${"b".repeat(32)}` },
    { secrets: `not-a-version:${"a".repeat(32)}` },
  ])("rejects weak or malformed authentication secrets", (environment) => {
    expect(() =>
      resolveAuthenticationConfig({
        mode: "required",
        baseURL: "https://remedence.example",
        ...environment,
      }),
    ).toThrow(
      "BETTER_AUTH_SECRET or every BETTER_AUTH_SECRETS value must contain at least 32 characters when authentication is required.",
    );
  });

  it.each(["enabled", "REQUIRED", ""])(
    "rejects unknown authentication mode %j",
    (mode) => {
      expect(() => resolveAuthenticationConfig({ mode })).toThrow(
        'REMEDENCE_AUTH_MODE must be either "local" or "required".',
      );
    },
  );

  it.each(["1", "yes", "TRUE", ""])(
    "rejects an invalid MFA policy %j",
    (requireMfa) => {
      expect(() =>
        resolveAuthenticationConfig({
          mode: "required",
          baseURL: "http://127.0.0.1:43180",
          secret: "a".repeat(32),
          requireMfa,
        }),
      ).toThrow('REMEDENCE_REQUIRE_MFA must be either "true" or "false".');
    },
  );

  it("requires authenticated HTTPS password-reset delivery in production", () => {
    expect(() =>
      resolveAuthenticationConfig({
        mode: "required",
        baseURL: "https://remedence.example",
        secret: "a".repeat(32),
      }),
    ).toThrow("REMEDENCE_PASSWORD_RESET_WEBHOOK_URL must be HTTPS");
    expect(() =>
      resolveAuthenticationConfig({
        mode: "required",
        baseURL: "https://remedence.example",
        secret: "a".repeat(32),
        passwordResetWebhookURL: "http://mailer.example/reset",
        passwordResetWebhookToken: "b".repeat(32),
      }),
    ).toThrow("REMEDENCE_PASSWORD_RESET_WEBHOOK_URL must be HTTPS");
  });

  it.each([
    "http://remedence.example",
    "http://localhost:43180",
    "http://127.0.0.1",
    "https://user:password@remedence.example",
    "https://remedence.example/path",
    "https://remedence.example?tenant=other",
  ])("rejects unsafe required-authentication URL %j", (baseURL) => {
    expect(() =>
      resolveAuthenticationConfig({
        mode: "required",
        baseURL,
        secret: "a".repeat(32),
      }),
    ).toThrow(
      "BETTER_AUTH_URL must be an explicit HTTPS origin, or an HTTP 127.0.0.1 origin for local testing.",
    );
  });
});
