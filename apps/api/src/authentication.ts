import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth/minimal";
import { fromNodeHeaders } from "better-auth/node";
import { twoFactor } from "better-auth/plugins";
import type { DatabaseSync } from "node:sqlite";
import type { MutationActor } from "@remedence/core";
import type {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
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
  handler: (request: globalThis.Request) => Promise<globalThis.Response>;
  getSession: (headers: Headers) => Promise<AuthenticationSession | null>;
}

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
}

export function authenticatedPrincipalFrom(
  response: ExpressResponse,
): AuthenticatedPrincipal | undefined {
  return response.locals.authenticatedPrincipal as
    AuthenticatedPrincipal | undefined;
}

export function mutationActorFrom(response: ExpressResponse): MutationActor {
  const principal = authenticatedPrincipalFrom(response);
  return principal
    ? { actorType: "user", actorId: principal.userId }
    : { actorType: "local_user", actorId: "local-workspace" };
}

export function requireAuthenticatedPrincipal(
  authentication: RemedenceAuthentication,
) {
  return async function authenticationRequired(
    request: ExpressRequest,
    response: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const session = await authentication.getSession(
        fromNodeHeaders(request.headers),
      );
      if (!session) {
        next(
          Object.assign(new Error("Authentication is required."), {
            status: 401,
            code: "AUTHENTICATION_REQUIRED",
          }),
        );
        return;
      }
      response.locals.authenticatedPrincipal = {
        userId: session.user.id,
        sessionId: session.session.id,
        name: session.user.name,
        email: session.user.email,
      } satisfies AuthenticatedPrincipal;
      next();
    } catch (error) {
      next(error);
    }
  };
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
