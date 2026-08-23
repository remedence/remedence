import { DomainError } from "@remedence/core";
import type { NextFunction, Request, Response } from "express";
import { requestIdFrom } from "./request-context.js";

interface ErrorWithStatus {
  status?: unknown;
  code?: unknown;
  type?: unknown;
  message?: unknown;
  path?: unknown;
  errors?: unknown;
}

interface ProblemFieldError {
  path: string;
  message: string;
}

function titleFor(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 413:
      return "Payload Too Large";
    case 429:
      return "Too Many Requests";
    default:
      return "Internal Server Error";
  }
}

function safeValidationErrors(value: unknown): ProblemFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const errors = value.map((item): ProblemFieldError => {
    if (typeof item !== "object" || item === null) {
      return { path: "request", message: "Invalid request value." };
    }
    const candidate = item as Record<string, unknown>;
    return {
      path: typeof candidate.path === "string" ? candidate.path : "request",
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Invalid request value.",
    };
  });
  return errors.length > 0 ? errors : undefined;
}

function sendProblem(
  response: Response,
  request: Request,
  status: number,
  code: string,
  detail: string,
  errors?: ProblemFieldError[],
): void {
  response
    .status(status)
    .type("application/problem+json")
    .json({
      type: "about:blank",
      title: titleFor(status),
      status,
      detail,
      instance: request.originalUrl,
      code,
      request_id: requestIdFrom(response),
      ...(errors ? { errors } : {}),
    });
}

export function problemHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (error instanceof DomainError) {
    sendProblem(response, request, error.status, error.code, error.message);
    return;
  }

  const candidate =
    typeof error === "object" && error !== null
      ? (error as ErrorWithStatus)
      : undefined;

  if (candidate?.status === 404) {
    sendProblem(
      response,
      request,
      404,
      "NOT_FOUND",
      "The requested resource was not found.",
    );
    return;
  }

  if (candidate?.status === 403) {
    sendProblem(
      response,
      request,
      403,
      typeof candidate.code === "string" ? candidate.code : "FORBIDDEN",
      "The request origin is not permitted.",
    );
    return;
  }

  if (candidate?.status === 429) {
    sendProblem(
      response,
      request,
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many requests were received. Retry after the indicated interval.",
    );
    return;
  }

  if (candidate?.type === "entity.too.large" || candidate?.status === 413) {
    sendProblem(
      response,
      request,
      413,
      "REQUEST_TOO_LARGE",
      "JSON request body exceeds the 256 KiB limit.",
    );
    return;
  }

  if (candidate?.status === 400 || candidate?.status === 415) {
    sendProblem(
      response,
      request,
      400,
      "INVALID_REQUEST",
      "Request validation failed.",
      safeValidationErrors(candidate.errors),
    );
    return;
  }

  sendProblem(
    response,
    request,
    500,
    "INTERNAL_ERROR",
    "An unexpected server error occurred.",
  );
}
