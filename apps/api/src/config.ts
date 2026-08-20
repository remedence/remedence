export const API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 43_180;

export interface ApiConfig {
  host: typeof API_HOST;
  port: number;
}

const PORT_ERROR =
  "REMEDENCE_API_PORT must be an integer from 1024 through 65535.";

export function resolveApiPort(value = process.env.REMEDENCE_API_PORT): number {
  if (value === undefined) return DEFAULT_API_PORT;
  if (!/^\d+$/.test(value)) throw new Error(PORT_ERROR);

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(PORT_ERROR);
  }
  return port;
}

export function getApiConfig(): ApiConfig {
  return {
    host: API_HOST,
    port: resolveApiPort(),
  };
}
