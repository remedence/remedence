import { describe, expect, it } from "vitest";
import {
  API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_DEV_ORIGIN,
  isProductionMode,
  resolveApiPort,
  resolveDevelopmentOrigin,
} from "../src/config.js";

describe("local API configuration", () => {
  it("keeps the unauthenticated API on loopback", () => {
    expect(API_HOST).toBe("127.0.0.1");
  });

  it("uses the approved default port and accepts a bounded override", () => {
    expect(resolveApiPort(undefined)).toBe(DEFAULT_API_PORT);
    expect(resolveApiPort("5500")).toBe(5500);
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
});
