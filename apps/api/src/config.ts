import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 43_180;
export const DEFAULT_DATA_DIRECTORY = "data";
export const DEFAULT_WEB_DIRECTORY = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

export interface ApiConfig {
  host: typeof API_HOST;
  port: number;
  dataDirectory: string;
  databasePath: string;
  serveWeb: boolean;
  webDirectory: string;
}

const PORT_ERROR =
  "REMEDENCE_API_PORT must be an integer from 1024 through 65535.";
const DATA_DIRECTORY_ERROR = "REMEDENCE_DATA_DIR must not be empty.";

export function isProductionMode(
  value: string | undefined,
  lifecycleEvent: string | undefined,
): boolean {
  return value === "production" || lifecycleEvent === "start";
}

export function resolveApiPort(value = process.env.REMEDENCE_API_PORT): number {
  if (value === undefined) return DEFAULT_API_PORT;
  if (!/^\d+$/.test(value)) throw new Error(PORT_ERROR);

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(PORT_ERROR);
  }
  return port;
}

export function resolveDataDirectory(
  value = process.env.REMEDENCE_DATA_DIR,
): string {
  if (value === undefined) return resolve(DEFAULT_DATA_DIRECTORY);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(DATA_DIRECTORY_ERROR);
  return resolve(trimmed);
}

export function getApiConfig(): ApiConfig {
  const dataDirectory = resolveDataDirectory();
  return {
    host: API_HOST,
    port: resolveApiPort(),
    dataDirectory,
    databasePath: join(dataDirectory, "remedence.db"),
    serveWeb: isProductionMode(
      process.env.NODE_ENV,
      process.env.npm_lifecycle_event,
    ),
    webDirectory: DEFAULT_WEB_DIRECTORY,
  };
}
