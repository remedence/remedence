import createClient from "openapi-fetch";
import type { paths } from "./schema";

const sameOriginApiBaseUrl = new URL(
  "/api/v1",
  globalThis.location?.origin ?? "http://localhost",
).toString();

export const api = createClient<paths>({
  baseUrl: sameOriginApiBaseUrl,
  fetch: (input) => {
    const request = new Request(input);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !request.headers.has("idempotency-key")
    ) {
      request.headers.set("idempotency-key", idempotencyKey());
    }
    return globalThis.fetch(request);
  },
});

export function idempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function entityTag(kind: string, id: string, version: number): string {
  const bytes = new TextEncoder().encode(id);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encodedId = globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `"${kind}.${encodedId}.v${version}"`;
}
