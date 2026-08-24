import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth/minimal";
import { fromNodeHeaders } from "better-auth/node";
import { twoFactor } from "better-auth/plugins";
import type { DatabaseSync } from "node:sqlite";
import type { MutationActor, TrustedVerifierPrincipal } from "@remedence/core";
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

export interface InitialOwnerInput {
  name: string;
  email: string;
  password: string;
}

export interface InitialOwnerResult {
  userId: string;
  email: string;
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
  getPrincipal: (headers: Headers) => Promise<AuthenticatedPrincipal | null>;
}

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  organizationId: string;
  role: "Owner" | "Administrator" | "Member" | "Verifier";
}

export function authenticatedPrincipalFrom(
  response: ExpressResponse,
): AuthenticatedPrincipal | undefined {
  return response.locals.authenticatedPrincipal as
    AuthenticatedPrincipal | undefined;
}

export function mutationActorFrom(response: ExpressResponse): MutationActor {
  const principal = authenticatedPrincipalFrom(response);
  if (!principal) throw new Error("Request principal was not established.");
  return principal.userId === "local-workspace"
    ? { actorType: "local_user", actorId: principal.userId }
    : { actorType: "user", actorId: principal.userId };
}

export function trustedVerifierFrom(
  response: ExpressResponse,
): TrustedVerifierPrincipal {
  const principal = authenticatedPrincipalFrom(response);
  if (!principal) throw new Error("Request principal was not established.");
  return {
    principalId:
      principal.userId === "local-workspace"
        ? "local-verification-process"
        : principal.userId,
    displayName:
      principal.userId === "local-workspace"
        ? "Local verification process"
        : principal.name,
    credentialType:
      principal.userId === "local-workspace" ? "local-process" : "session",
  };
}

export function verificationActorFrom(
  response: ExpressResponse,
): MutationActor {
  const verifier = trustedVerifierFrom(response);
  return {
    actorType:
      verifier.credentialType === "local-process" ? "local_worker" : "user",
    actorId: verifier.principalId,
  };
}

export function organizationIdFrom(response: ExpressResponse): string {
  const principal = authenticatedPrincipalFrom(response);
  if (!principal) throw new Error("Request principal was not established.");
  return principal.organizationId;
}

export function establishLocalPrincipal(
  organizationId: string | (() => string),
) {
  return function localPrincipal(
    _request: ExpressRequest,
    response: ExpressResponse,
    next: NextFunction,
  ): void {
    response.locals.authenticatedPrincipal = {
      userId: "local-workspace",
      sessionId: "local-workspace",
      name: "Local workspace",
      email: "",
      organizationId:
        typeof organizationId === "function"
          ? organizationId()
          : organizationId,
      role: "Owner",
    } satisfies AuthenticatedPrincipal;
    next();
  };
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
      const principal = await authentication.getPrincipal(
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
      if (!principal) {
        next(
          Object.assign(
            new Error("An active organization membership is required."),
            {
              status: 403,
              code: "ORGANIZATION_ACCESS_REQUIRED",
            },
          ),
        );
        return;
      }
      response.locals.authenticatedPrincipal = principal;
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
    getPrincipal: async (headers) => {
      const session = await authentication.api.getSession({ headers });
      if (!session) return null;

      const memberships = getDatabaseConnection(database)
        .prepare(
          `SELECT organization_id, role
           FROM organization_memberships
           WHERE user_id = ? AND status = 'Active'
           ORDER BY organization_id`,
        )
        .all(session.user.id) as unknown as Array<{
        organization_id: string;
        role: AuthenticatedPrincipal["role"];
      }>;
      const requestedOrganization = headers.get("x-remedence-organization");
      const membership = requestedOrganization
        ? memberships.find(
            (item) => item.organization_id === requestedOrganization,
          )
        : memberships.length === 1
          ? memberships[0]
          : undefined;
      if (!membership) return null;

      return {
        userId: session.user.id,
        sessionId: session.session.id,
        name: session.user.name,
        email: session.user.email,
        organizationId: membership.organization_id,
        role: membership.role,
      };
    },
  };
}

export async function provisionInitialOwner(
  database: RemedenceDatabase,
  config: Extract<AuthenticationConfig, { mode: "required" }>,
  input: InitialOwnerInput,
): Promise<InitialOwnerResult> {
  const connection = getDatabaseConnection(database);
  const existing = connection
    .prepare('SELECT COUNT(*) AS count FROM "user"')
    .get() as { count: number };
  if (existing.count !== 0) {
    throw new Error("Initial owner bootstrap requires an empty user table.");
  }

  const name = input.name.trim();
  const email = input.email.trim().toLocaleLowerCase("en-US");
  if (!name || !email || input.password.length < 12) {
    throw new Error(
      "Initial owner requires a name, email, and password of at least 12 characters.",
    );
  }

  const organizations = connection
    .prepare("SELECT id FROM organizations ORDER BY id LIMIT 2")
    .all() as unknown as Array<{ id: string }>;
  if (organizations.length !== 1) {
    throw new Error(
      "Initial owner bootstrap requires exactly one initialized organization.",
    );
  }

  const authentication = createAuthentication(database, config, {
    allowPublicSignUp: true,
  });
  if (!authentication) throw new Error("Authentication is not required.");

  const response = await authentication.handler(
    new Request(`${config.baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: config.baseURL,
      },
      body: JSON.stringify({ name, email, password: input.password }),
    }),
  );
  if (!response.ok) throw new Error("Initial owner provisioning failed.");

  const user = connection
    .prepare('SELECT id, email FROM "user" WHERE email = ?')
    .get(email) as { id: string; email: string } | undefined;
  if (!user) throw new Error("Initial owner provisioning failed.");

  try {
    const now = new Date().toISOString();
    connection
      .prepare(
        `INSERT INTO organization_memberships (
           organization_id, user_id, role, status, created_at, updated_at
         ) VALUES (?, ?, 'Owner', 'Active', ?, ?)`,
      )
      .run(organizations[0]!.id, user.id, now, now);
    connection.prepare('DELETE FROM "session" WHERE "userId" = ?').run(user.id);
  } catch (error) {
    connection.prepare('DELETE FROM "user" WHERE id = ?').run(user.id);
    throw error;
  }
  return { userId: user.id, email: user.email };
}
