import { createHash } from "node:crypto";
import { DomainError } from "@remedence/core";
import type { IdempotencyScope, IdempotencyStore } from "@remedence/database";
import type { NextFunction, Request, Response } from "express";
import { authenticatedPrincipalFrom } from "../authentication.js";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function requestHash(request: Request): string {
  return createHash("sha256")
    .update(request.method)
    .update("\n")
    .update(request.path)
    .update("\n")
    .update(request.get("content-type") ?? "")
    .update("\n")
    .update(canonicalJson(request.body))
    .digest("hex");
}

function replayHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["etag", "location"]) {
    const value = response.getHeader(name);
    if (typeof value === "string") result[name] = value;
  }
  return result;
}

export function createIdempotency(
  store: IdempotencyStore,
  now: () => string = () => new Date().toISOString(),
) {
  return function idempotency(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      next();
      return;
    }

    const key = request.get("idempotency-key");
    if (key === undefined) {
      next();
      return;
    }
    if (!KEY_PATTERN.test(key)) {
      next(
        new DomainError(
          "IDEMPOTENCY_KEY_INVALID",
          400,
          "Idempotency-Key must be 8 to 200 safe ASCII characters.",
        ),
      );
      return;
    }

    const principal = authenticatedPrincipalFrom(response);
    if (!principal) {
      next(new Error("Request principal was not established."));
      return;
    }
    const scope: IdempotencyScope = {
      organizationId:
        request.path === "/onboarding"
          ? "workspace-bootstrap"
          : principal.organizationId,
      actorId: principal.userId,
      key,
      operation: `${request.method} ${request.path}`,
      requestHash: requestHash(request),
    };
    const createdAt = now();
    const expiresAt = new Date(
      new Date(createdAt).getTime() + RETENTION_MS,
    ).toISOString();
    const reservation = store.begin(scope, createdAt, expiresAt);

    if (reservation.outcome === "key-reused") {
      next(
        new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "This idempotency key was already used for a different request.",
        ),
      );
      return;
    }
    if (reservation.outcome === "in-progress") {
      next(
        new DomainError(
          "IDEMPOTENCY_REQUEST_IN_PROGRESS",
          409,
          "A request with this idempotency key is still in progress.",
        ),
      );
      return;
    }
    if (reservation.outcome === "replay") {
      for (const [name, value] of Object.entries(
        reservation.response.headers,
      )) {
        response.setHeader(name, value);
      }
      response.setHeader("Idempotency-Replayed", "true");
      response
        .status(reservation.response.statusCode)
        .json(reservation.response.body);
      return;
    }

    let settled = false;
    const originalJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      if (!settled) {
        settled = true;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          store.complete(
            scope,
            response.statusCode,
            replayHeaders(response),
            body,
            now(),
          );
          response.setHeader("Idempotency-Replayed", "false");
        } else {
          store.release(scope);
        }
      }
      return originalJson(body);
    }) as Response["json"];
    response.once("close", () => {
      if (!settled) store.release(scope);
    });
    next();
  };
}
