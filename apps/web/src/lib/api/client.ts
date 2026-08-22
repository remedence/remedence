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
