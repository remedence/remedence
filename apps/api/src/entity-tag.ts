import { DomainError } from "@remedence/core";
import type { Request, Response } from "express";

export function entityTag(kind: string, id: string, version: number): string {
  const encodedId = Buffer.from(id, "utf8").toString("base64url");
  return `"${kind}.${encodedId}.v${version}"`;
}

export function setEntityTag(
  response: Response,
  kind: string,
  id: string,
  version: number,
): void {
  response.setHeader("ETag", entityTag(kind, id, version));
}

export function requireIfMatch(
  request: Request,
  kind: string,
  id: string,
): number {
  const value = request.get("if-match");
  if (!value) {
    throw new DomainError(
      "PRECONDITION_REQUIRED",
      428,
      "This mutation requires the current resource ETag in If-Match.",
    );
  }
  const match = /^"([a-z-]+)\.([A-Za-z0-9_-]+)\.v([1-9][0-9]*)"$/.exec(value);
  let decodedId = "";
  try {
    decodedId = match
      ? Buffer.from(match[2]!, "base64url").toString("utf8")
      : "";
  } catch {
    decodedId = "";
  }
  const version = match ? Number(match[3]) : Number.NaN;
  if (
    match?.[1] !== kind ||
    decodedId !== id ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new DomainError(
      "PRECONDITION_FAILED",
      412,
      "If-Match does not identify the current target resource.",
    );
  }
  return version;
}
