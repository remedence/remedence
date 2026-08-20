import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /healthz", () => {
  it("returns local process readiness without paths", async () => {
    const response = await request(createApp()).get("/healthz").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      database: "not-configured",
      schema_version: 0,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Z]:\\|\/home\//);
  });
});
