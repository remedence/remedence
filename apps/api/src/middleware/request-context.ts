import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function requestIdFrom(response: Response): string {
  const value = response.locals.requestId;
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    throw new Error("Request context is unavailable.");
  }
  return value;
}

export function createRequestContext(
  log: (entry: Record<string, unknown>) => void,
) {
  return function requestContext(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const supplied = request.get("X-Request-ID");
    const requestId =
      supplied !== undefined && REQUEST_ID_PATTERN.test(supplied)
        ? supplied
        : randomUUID();
    const startedAt = performance.now();

    response.locals.requestId = requestId;
    response.setHeader("X-Request-ID", requestId);
    response.once("finish", () => {
      log({
        request_id: requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        duration_ms:
          Math.max(0, Math.round((performance.now() - startedAt) * 100)) / 100,
      });
    });

    next();
  };
}
