import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth/minimal";
import { twoFactor } from "better-auth/plugins";
import type { DatabaseSync } from "node:sqlite";
import {
  getDatabaseConnection,
  type RemedenceDatabase,
} from "@remedence/database";
import type { AuthenticationConfig } from "./config.js";

export interface AuthenticationOptions {
  allowPublicSignUp?: boolean;
}

export interface AuthenticationSession {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

export interface RemedenceAuthentication {
  handler: (request: Request) => Promise<Response>;
  getSession: (headers: Headers) => Promise<AuthenticationSession | null>;
}

export function createAuthenticationOptions(
  database: DatabaseSync,
  config: Extract<AuthenticationConfig, { mode: "required" }>,
  options: AuthenticationOptions = {},
): BetterAuthOptions {
  return {
    appName: "Remedence",
    baseURL: config.baseURL,
    database,
    trustedOrigins: [config.baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !(options.allowPublicSignUp ?? false),
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 8 * 60 * 60,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { joins: true },
      useSecureCookies: config.baseURL.startsWith("https://"),
    },
    plugins: [twoFactor({ issuer: "Remedence" })],
  };
}

export function createAuthentication(
  database: RemedenceDatabase,
  config: AuthenticationConfig,
  options: AuthenticationOptions = {},
): RemedenceAuthentication | null {
  if (config.mode === "local") return null;

  const authentication = betterAuth(
    createAuthenticationOptions(
      getDatabaseConnection(database),
      config,
      options,
    ),
  );

  return {
    handler: authentication.handler,
    getSession: (headers) => authentication.api.getSession({ headers }),
  };
}
