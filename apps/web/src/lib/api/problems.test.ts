import { describe, expect, it } from "vitest";
import { problemFromResponse, problemFromUnknown } from "./problems";

describe("API problem fallbacks", () => {
  it("uses request-neutral wording for malformed API problem responses", () => {
    const response = new Response("not a structured problem", {
      status: 500,
      headers: { "X-Request-ID": "req-malformed" },
    });

    expect(problemFromResponse(undefined, response)).toMatchObject({
      title: "Unable to complete request",
      detail: "The local API returned an unreadable error response.",
      code: "INVALID_API_PROBLEM",
      request_id: "req-malformed",
    });
  });

  it("uses request-neutral wording when the local API cannot be reached", () => {
    expect(problemFromUnknown(new TypeError("fetch failed"))).toMatchObject({
      title: "Unable to reach local API",
      detail:
        "Remedence could not reach the local API. Check the local service and try again.",
      code: "LOCAL_API_UNAVAILABLE",
    });
  });
});
