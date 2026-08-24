import createClient from "openapi-fetch";
import type { paths } from "./schema";

const sameOriginApiBaseUrl = new URL(
  "/api/v1",
  globalThis.location?.origin ?? "http://localhost",
).toString();

export const api = createClient<paths>({
  baseUrl: sameOriginApiBaseUrl,
  fetch: (...arguments_) => globalThis.fetch(...arguments_),
});

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
