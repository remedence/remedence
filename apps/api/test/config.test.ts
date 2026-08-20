import { describe, expect, it } from "vitest";
import { API_HOST, DEFAULT_API_PORT, resolveApiPort } from "../src/config.js";

describe("local API configuration", () => {
  it("keeps the unauthenticated API on loopback", () => {
    expect(API_HOST).toBe("127.0.0.1");
  });

  it("uses the approved default port and accepts a bounded override", () => {
    expect(resolveApiPort(undefined)).toBe(DEFAULT_API_PORT);
    expect(resolveApiPort("5500")).toBe(5500);
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
