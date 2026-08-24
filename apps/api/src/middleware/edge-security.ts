import type { NextFunction, Request, Response } from "express";
import type { RateLimitStore } from "@remedence/database";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

export type RateLimitKey = (request: Request, response: Response) => string;

function requestOrigin(request: Request): string {
  const host = request.get("host");
  if (!host) return "";
  return `${request.protocol}://${host}`;
}

export function setSecurityHeaders(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=()",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");

  if (
    request.path === "/healthz" ||
    request.path === "/livez" ||
    request.path === "/readyz" ||
    request.path.startsWith("/api/")
  ) {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
}

export function createSameOriginGuard(allowedOrigins: readonly string[] = []) {
  const allowed = new Set(allowedOrigins);
  return function requireSameOrigin(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): void {
    if (
      !request.path.startsWith("/api/") ||
      !MUTATING_METHODS.has(request.method)
    ) {
      next();
      return;
    }

    const origin = request.get("origin");
    const fetchSite = request.get("sec-fetch-site")?.toLowerCase();
    const permittedOrigin =
      origin === undefined ||
      origin === requestOrigin(request) ||
      allowed.has(origin);
    if (
      !permittedOrigin ||
      (fetchSite === "cross-site" && !allowed.has(origin ?? ""))
    ) {
      next(
        Object.assign(new Error("Cross-origin mutation rejected."), {
          status: 403,
          code: "CROSS_ORIGIN_REQUEST_REJECTED",
        }),
      );
      return;
    }

    next();
  };
}

export function createRateLimit(
  options: RateLimitOptions,
  store: RateLimitStore,
  keyFor: RateLimitKey = (request) =>
    `client:${request.socket.remoteAddress ?? "unknown"}`,
) {
  if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
    throw new Error("Rate limit maxRequests must be a positive integer.");
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new Error("Rate limit windowMs must be a positive integer.");
  }

  const now = options.now ?? Date.now;

  return function rateLimit(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!request.path.startsWith("/api/")) {
      next();
      return Promise.resolve();
    }

    const currentTime = now();
    return (async () => {
      const window = await store.consume(
        keyFor(request, response),
        currentTime,
        options.windowMs,
      );
      const remaining = Math.max(0, options.maxRequests - window.count);
      response.setHeader("RateLimit-Limit", String(options.maxRequests));
      response.setHeader("RateLimit-Remaining", String(remaining));
      response.setHeader(
        "RateLimit-Reset",
        String(Math.ceil(window.resetAt / 1000)),
      );

      if (window.count > options.maxRequests) {
        response.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((window.resetAt - currentTime) / 1000))),
        );
        next(
          Object.assign(new Error("Request rate limit exceeded."), {
            status: 429,
            code: "RATE_LIMIT_EXCEEDED",
          }),
        );
        return;
      }

      next();
    })().catch(next);
  };
}
