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
- mutation audit events use the authenticated Better Auth user ID instead of the local-workspace actor; and
- public email/password sign-up is disabled by default.

Sessions expire after eight hours and are eligible for refresh after one hour. Cookie session caching is disabled so revocation is checked against durable session state. HTTPS configurations force secure cookies. Password reset is configured to revoke other sessions. The two-factor plugin and schema are present, but enrollment and recovery interfaces are not yet exposed.

## Secret rotation

Prefer `BETTER_AUTH_SECRETS` for non-destructive rotation. The first entry is the active encryption key and remaining entries are decryption-only historical keys, for example `2:<new-value>,1:<old-value>`. Secret values are deployment-owned and must never be committed, logged, included in support bundles, or returned from readiness endpoints.

## Not yet production-complete

Required-authentication mode is an implemented security foundation, not a supported production release. There is not yet an owner-bootstrap command, invitation flow, sign-in UI, password-recovery delivery, enforced MFA policy, organization membership/RBAC mapping, OIDC/SAML configuration, or production secrets manager. Until those interfaces and their tests exist, public sign-up remains closed and the release model remains local beta.
