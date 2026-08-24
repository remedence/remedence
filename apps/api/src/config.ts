import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { VerificationExecutionProfile } from "@remedence/verification";
import {
  parseIntegrationKeyring,
  type IntegrationKeyring,
} from "./integration-runtime.js";

export const API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 43_180;
export const DEFAULT_DATA_DIRECTORY = "data";
export const DEFAULT_DEV_ORIGIN = "http://127.0.0.1:5173";
export const DEFAULT_WEB_DIRECTORY = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

export type AuthenticationConfig =
  | { mode: "local" }
  | {
      mode: "required";
      baseURL: string;
      requireMfa?: boolean;
      passwordResetDelivery?: PasswordResetDeliveryConfig | null;
    };

export interface PasswordResetDeliveryConfig {
  webhookURL: string;
  bearerToken: string;
}

export type EvidenceSecurityConfig =
  | { scanner: "local"; signingKey?: string }
  | { scanner: "clamav"; signingKey: string; host: string; port: number };

export interface ApiConfig {
  host: string;
  port: number;
  dataDirectory: string;
  databasePath: string;
  databaseUrl?: string;
  serveWeb: boolean;
  webDirectory: string;
  allowedMutationOrigins: readonly string[];
  authentication: AuthenticationConfig;
  workspaceMode: "empty" | "demo";
  evidence: EvidenceSecurityConfig;
  verificationProfiles: readonly VerificationExecutionProfile[];
  integrationKeyring?: IntegrationKeyring;
}

const PORT_ERROR =
  "REMEDENCE_API_PORT must be an integer from 1024 through 65535.";
const DATA_DIRECTORY_ERROR = "REMEDENCE_DATA_DIR must not be empty.";
const API_BIND_ERROR =
  "REMEDENCE_API_HOST may use 0.0.0.0 only with required authentication and an HTTPS application URL.";
const DEV_ORIGIN_ERROR =
  "REMEDENCE_DEV_ORIGIN must be an http://127.0.0.1 origin with a port.";
const AUTH_MODE_ERROR =
  'REMEDENCE_AUTH_MODE must be either "local" or "required".';
const AUTH_URL_ERROR =
  "BETTER_AUTH_URL must be an explicit HTTPS origin, or an HTTP 127.0.0.1 origin for local testing.";
const AUTH_SECRET_ERROR =
  "BETTER_AUTH_SECRET or every BETTER_AUTH_SECRETS value must contain at least 32 characters when authentication is required.";
const AUTH_MFA_ERROR =
  'REMEDENCE_REQUIRE_MFA must be either "true" or "false".';
const PASSWORD_RESET_DELIVERY_ERROR =
  "REMEDENCE_PASSWORD_RESET_WEBHOOK_URL must be HTTPS and REMEDENCE_PASSWORD_RESET_WEBHOOK_TOKEN must contain at least 32 characters.";
const WORKSPACE_MODE_ERROR =
  'REMEDENCE_WORKSPACE_MODE must be either "empty" or "demo".';
const EVIDENCE_SECURITY_ERROR =
  "Hosted mode requires REMEDENCE_EVIDENCE_SIGNING_KEY (32+ characters) and a ClamAV scanner host/port.";
const VERIFICATION_PROFILES_ERROR =
  "Hosted mode requires a valid REMEDENCE_VERIFICATION_PROFILES_PATH with digest-pinned, network-isolated profiles.";
const INTEGRATION_KEYS_ERROR =
  "Hosted mode requires REMEDENCE_INTEGRATION_ENCRYPTION_KEYS with versioned 32-byte base64 keys.";
const DATABASE_URL_ERROR =
  "Hosted mode requires a valid postgresql:// REMEDENCE_DATABASE_URL.";

export function resolveDatabaseUrl(
  authentication: AuthenticationConfig,
  value = process.env.REMEDENCE_DATABASE_URL,
): string | undefined {
  const hosted =
    authentication.mode === "required" &&
    authentication.baseURL.startsWith("https://");
  if (!value?.trim()) {
    if (hosted) throw new Error(DATABASE_URL_ERROR);
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(DATABASE_URL_ERROR);
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.pathname.slice(1)
  ) {
    throw new Error(DATABASE_URL_ERROR);
  }
  return parsed.href;
}

export function resolveIntegrationKeyring(
  authentication: AuthenticationConfig,
  value: string | undefined,
): IntegrationKeyring | undefined {
  const hosted =
    authentication.mode === "required" &&
    authentication.baseURL.startsWith("https://");
  if (!value?.trim()) {
    if (hosted) throw new Error(INTEGRATION_KEYS_ERROR);
    return undefined;
  }
  try {
    return parseIntegrationKeyring(value);
  } catch {
    throw new Error(INTEGRATION_KEYS_ERROR);
  }
}

export function resolveVerificationProfiles(
  authentication: AuthenticationConfig,
  path: string | undefined,
): readonly VerificationExecutionProfile[] {
  const hosted =
    authentication.mode === "required" &&
    authentication.baseURL.startsWith("https://");
  if (!path?.trim()) {
    if (hosted) throw new Error(VERIFICATION_PROFILES_ERROR);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    throw new Error(VERIFICATION_PROFILES_ERROR);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(VERIFICATION_PROFILES_ERROR);
  }
  const ids = new Set<string>();
  const profiles: VerificationExecutionProfile[] = [];
  for (const value of parsed) {
    const profile = value as Partial<VerificationExecutionProfile>;
    if (
      typeof profile.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{2,63}$/.test(profile.id) ||
      ids.has(profile.id) ||
      typeof profile.image !== "string" ||
      !/^.+@sha256:[0-9a-f]{64}$/.test(profile.image) ||
      !Array.isArray(profile.command) ||
      profile.command.length === 0 ||
      !profile.command.every(
        (item) => typeof item === "string" && item.length > 0,
      ) ||
      !Number.isInteger(profile.timeoutSeconds) ||
      profile.timeoutSeconds! < 1 ||
      profile.timeoutSeconds! > 3600 ||
      !Number.isInteger(profile.maxAttempts) ||
      profile.maxAttempts! < 1 ||
      profile.maxAttempts! > 10 ||
      !Number.isInteger(profile.memoryMegabytes) ||
      profile.memoryMegabytes! < 64 ||
      profile.memoryMegabytes! > 16_384 ||
      typeof profile.cpuCount !== "number" ||
      !Number.isFinite(profile.cpuCount) ||
      profile.cpuCount < 0.1 ||
      profile.cpuCount > 16 ||
      profile.network !== "none"
    ) {
      throw new Error(VERIFICATION_PROFILES_ERROR);
    }
    ids.add(profile.id);
    profiles.push(profile as VerificationExecutionProfile);
  }
  return profiles;
}

export function resolveEvidenceSecurityConfig(
  authentication: AuthenticationConfig,
  environment: {
    signingKey?: string;
    scanner?: string;
    scannerHost?: string;
    scannerPort?: string;
  },
): EvidenceSecurityConfig {
  const hosted =
    authentication.mode === "required" &&
    authentication.baseURL.startsWith("https://");
  const scanner = environment.scanner ?? (hosted ? "clamav" : "local");
  if (scanner === "local" && !hosted) {
    return {
      scanner: "local",
      ...(environment.signingKey ? { signingKey: environment.signingKey } : {}),
    };
  }
  const port = Number(environment.scannerPort ?? "3310");
  if (
    scanner !== "clamav" ||
    (environment.signingKey?.length ?? 0) < 32 ||
    !environment.scannerHost?.trim() ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(EVIDENCE_SECURITY_ERROR);
  }
  return {
    scanner: "clamav",
    signingKey: environment.signingKey!,
    host: environment.scannerHost.trim(),
    port,
  };
}

export function resolveWorkspaceMode(
  value = process.env.REMEDENCE_WORKSPACE_MODE,
): "empty" | "demo" {
  const mode = value ?? "empty";
  if (mode !== "empty" && mode !== "demo") {
    throw new Error(WORKSPACE_MODE_ERROR);
  }
  return mode;
}

export interface AuthenticationEnvironment {
  mode?: string | undefined;
  baseURL?: string | undefined;
  secret?: string | undefined;
  secrets?: string | undefined;
  requireMfa?: string | undefined;
  passwordResetWebhookURL?: string | undefined;
  passwordResetWebhookToken?: string | undefined;
}

function resolveBoolean(
  value: string | undefined,
  defaultValue: boolean,
  errorMessage: string,
): boolean {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(errorMessage);
}

function resolvePasswordResetDelivery(
  webhookURL: string | undefined,
  bearerToken: string | undefined,
  requireDelivery: boolean,
): PasswordResetDeliveryConfig | null {
  if (!webhookURL && !bearerToken && !requireDelivery) return null;
  let parsed: URL;
  try {
    parsed = new URL(webhookURL ?? "");
  } catch {
    throw new Error(PASSWORD_RESET_DELIVERY_ERROR);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (bearerToken?.length ?? 0) < 32
  ) {
    throw new Error(PASSWORD_RESET_DELIVERY_ERROR);
  }
  return { webhookURL: parsed.href, bearerToken: bearerToken! };
}

function hasValidAuthenticationSecret(
  secret: string | undefined,
  secrets: string | undefined,
): boolean {
  if (secrets?.trim()) {
    const versions = new Set<number>();
    const entries = secrets.split(",");
    return entries.every((entry) => {
      const separator = entry.indexOf(":");
      const version = Number(entry.slice(0, separator));
      const value = entry.slice(separator + 1);
      if (
        separator <= 0 ||
        !Number.isSafeInteger(version) ||
        version <= 0 ||
        versions.has(version) ||
        value.length < 32
      ) {
        return false;
      }
      versions.add(version);
      return true;
    });
  }
  return (secret?.length ?? 0) >= 32;
}

export function resolveAuthenticationConfig({
  mode,
  baseURL,
  secret,
  secrets,
  requireMfa,
  passwordResetWebhookURL,
  passwordResetWebhookToken,
}: AuthenticationEnvironment): AuthenticationConfig {
  const resolvedMode = mode ?? "local";
  if (resolvedMode === "local") return { mode: "local" };
  if (resolvedMode !== "required") throw new Error(AUTH_MODE_ERROR);

  if (!hasValidAuthenticationSecret(secret, secrets)) {
    throw new Error(AUTH_SECRET_ERROR);
  }
  if (!baseURL) throw new Error(AUTH_URL_ERROR);

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error(AUTH_URL_ERROR);
  }

  const isSecureOrigin = parsed.protocol === "https:";
  const isLoopbackTestOrigin =
    parsed.protocol === "http:" &&
    parsed.hostname === API_HOST &&
    parsed.port !== "";
  if (
    (!isSecureOrigin && !isLoopbackTestOrigin) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(AUTH_URL_ERROR);
  }

  return {
    mode: "required",
    baseURL: parsed.origin,
    requireMfa: resolveBoolean(requireMfa, isSecureOrigin, AUTH_MFA_ERROR),
    passwordResetDelivery: resolvePasswordResetDelivery(
      passwordResetWebhookURL,
      passwordResetWebhookToken,
      isSecureOrigin,
    ),
  };
}

export function resolveDevelopmentOrigin(
  value = process.env.REMEDENCE_DEV_ORIGIN,
): string {
  const candidate = value ?? DEFAULT_DEV_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(DEV_ORIGIN_ERROR);
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port === "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(DEV_ORIGIN_ERROR);
  }
  return parsed.origin;
}

export function isProductionMode(
  value: string | undefined,
  lifecycleEvent: string | undefined,
): boolean {
  if (lifecycleEvent === "start") return true;
  if (lifecycleEvent === "dev") return false;
  return value === "production";
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

export function resolveApiHost(
  authentication: AuthenticationConfig,
  value = process.env.REMEDENCE_API_HOST,
): string {
  const host = value?.trim() || API_HOST;
  if (host === API_HOST) return host;
  if (
    host === "0.0.0.0" &&
    authentication.mode === "required" &&
    authentication.baseURL.startsWith("https://")
  ) {
    return host;
  }
  throw new Error(API_BIND_ERROR);
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
  const serveWeb = isProductionMode(
    process.env.NODE_ENV,
    process.env.npm_lifecycle_event,
  );
  const authentication = resolveAuthenticationConfig({
    mode: process.env.REMEDENCE_AUTH_MODE,
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    secrets: process.env.BETTER_AUTH_SECRETS,
    requireMfa: process.env.REMEDENCE_REQUIRE_MFA,
    passwordResetWebhookURL: process.env.REMEDENCE_PASSWORD_RESET_WEBHOOK_URL,
    passwordResetWebhookToken:
      process.env.REMEDENCE_PASSWORD_RESET_WEBHOOK_TOKEN,
  });
  const integrationKeyring = resolveIntegrationKeyring(
    authentication,
    process.env.REMEDENCE_INTEGRATION_ENCRYPTION_KEYS,
  );
  const databaseUrl = resolveDatabaseUrl(authentication);
  return {
    host: resolveApiHost(authentication),
    port: resolveApiPort(),
    dataDirectory,
    databasePath: join(dataDirectory, "remedence.db"),
    ...(databaseUrl ? { databaseUrl } : {}),
    serveWeb,
    webDirectory: DEFAULT_WEB_DIRECTORY,
    allowedMutationOrigins: serveWeb ? [] : [resolveDevelopmentOrigin()],
    authentication,
    evidence: resolveEvidenceSecurityConfig(authentication, {
      ...(process.env.REMEDENCE_EVIDENCE_SIGNING_KEY
        ? { signingKey: process.env.REMEDENCE_EVIDENCE_SIGNING_KEY }
        : {}),
      ...(process.env.REMEDENCE_MALWARE_SCANNER
        ? { scanner: process.env.REMEDENCE_MALWARE_SCANNER }
        : {}),
      ...(process.env.REMEDENCE_CLAMAV_HOST
        ? { scannerHost: process.env.REMEDENCE_CLAMAV_HOST }
        : {}),
      ...(process.env.REMEDENCE_CLAMAV_PORT
        ? { scannerPort: process.env.REMEDENCE_CLAMAV_PORT }
        : {}),
    }),
    verificationProfiles: resolveVerificationProfiles(
      authentication,
      process.env.REMEDENCE_VERIFICATION_PROFILES_PATH,
    ),
    ...(integrationKeyring ? { integrationKeyring } : {}),
    workspaceMode: resolveWorkspaceMode(),
  };
}
