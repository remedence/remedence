import type { components } from "./schema";

export type ApiProblem = components["schemas"]["Problem"];

export class ApiProblemError extends Error {
  constructor(public readonly problem: ApiProblem) {
    super(problem.detail);
    this.name = "ApiProblemError";
  }
}

export function isApiProblem(value: unknown): value is ApiProblem {
  if (!value || typeof value !== "object") return false;
  const problem = value as Record<string, unknown>;
  return (
    typeof problem.type === "string" &&
    typeof problem.title === "string" &&
    typeof problem.status === "number" &&
    typeof problem.detail === "string" &&
    typeof problem.instance === "string" &&
    typeof problem.code === "string" &&
    typeof problem.request_id === "string"
  );
}

export function problemFromResponse(
  error: unknown,
  response: Response,
): ApiProblem {
  if (isApiProblem(error)) return error;

  return {
    type: "about:blank",
    title: "Unable to complete request",
    status: response.status,
    detail: "The local API returned an unreadable error response.",
    instance: response.url || "/api/v1",
    code: "INVALID_API_PROBLEM",
    request_id: response.headers.get("X-Request-ID") ?? "",
  };
}

export function problemFromUnknown(error: unknown): ApiProblem {
  if (error instanceof ApiProblemError) return error.problem;
  if (isApiProblem(error)) return error;

  return {
    type: "about:blank",
    title: "Unable to reach local API",
    status: 0,
    detail:
      "Remedence could not reach the local API. Check the local service and try again.",
    instance: "/api/v1",
    code: "LOCAL_API_UNAVAILABLE",
    request_id: "",
  };
}
