# Authentication

## Implemented boundary

Remedence has one authentication module backed by Better Auth 1.7.1 and the existing Remedence SQLite connection. Migration `0002_better_auth.sql` owns the user, session, account, verification, and two-factor tables. The repository migration runner applies that schema transactionally before authentication is created.

The default `REMEDENCE_AUTH_MODE=local` behavior preserves the current loopback-only local beta. In this mode no authentication handler is mounted and the operating-system user session remains the trust boundary.

`REMEDENCE_AUTH_MODE=required` changes the boundary:

- startup fails unless `BETTER_AUTH_URL` is an explicit HTTPS origin, or an explicit `http://127.0.0.1:<port>` origin for local testing;
- startup fails unless `BETTER_AUTH_SECRET` contains at least 32 characters or every `BETTER_AUTH_SECRETS` entry uses the documented `version:value` form with at least 32 value characters;
- Better Auth handles `/api/auth/*` before Express JSON parsing, as required by its Express integration;
- liveness and readiness probes remain unauthenticated;
- every `/api/v1` route requires a valid database-backed session;
- every product request resolves an active `organization_memberships` row, and a multi-membership user must send `X-Remedence-Organization` for an organization they belong to;
- mutation audit events use the authenticated Better Auth user ID instead of the local-workspace actor; and
- public email/password sign-up is disabled by default; and
- the web application presents a sign-in screen, refreshes durable session state after login/logout, and shows the authenticated account identity.

## Initial owner

Provision the first owner only while the application is stopped, the Better Auth user table is empty, and exactly one organization has been initialized. Supply `REMEDENCE_AUTH_MODE`, `BETTER_AUTH_URL`, Better Auth secret material, the data directory, and `REMEDENCE_BOOTSTRAP_PASSWORD` through the deployment's secret-injection mechanism, then run:

```text
bun run auth:bootstrap --name <owner-name> --email <owner-email>
```

The password is never accepted as a command-line argument and is removed from the bootstrap process environment before database work begins. Provisioning refuses to run after any user exists, hashes the credential through Better Auth, creates the user's active Owner membership, and deletes the bootstrap-created session so the owner must perform a normal sign-in. If membership persistence fails, the partially created user is removed. Remove `REMEDENCE_BOOTSTRAP_PASSWORD` from the deployment environment immediately after the command exits.

Sessions expire after eight hours and are eligible for refresh after one hour. Cookie session caching is disabled so revocation is checked against durable session state. HTTPS configurations force secure cookies. Password reset is configured to revoke other sessions. The two-factor plugin and schema are present, but enrollment and recovery interfaces are not yet exposed.

## Secret rotation

Prefer `BETTER_AUTH_SECRETS` for non-destructive rotation. The first entry is the active encryption key and remaining entries are decryption-only historical keys, for example `2:<new-value>,1:<old-value>`. Secret values are deployment-owned and must never be committed, logged, included in support bundles, or returned from readiness endpoints.

## Not yet production-complete

Required-authentication mode is an implemented security foundation, not a supported production release. Organization membership and tenant selection are implemented, but there is not yet an invitation flow, password-recovery delivery, enforced MFA enrollment/challenge UI, endpoint-level role authorization, OIDC/SAML configuration, or production secrets manager. Until those interfaces and their tests exist, public sign-up remains closed and the release model remains local beta.
