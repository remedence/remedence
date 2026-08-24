# Authentication

## Implemented boundary

Remedence has one authentication module backed by Better Auth. Local mode uses the hardened SQLite connection; production passes the shared PostgreSQL pool directly to Better Auth. The controlled migration schemas own user, session, account, verification, two-factor, SSO-provider, and tenant-membership tables before authentication starts.

The default `REMEDENCE_AUTH_MODE=local` behavior preserves the current loopback-only local beta. In this mode no authentication handler is mounted and the operating-system user session remains the trust boundary.

`REMEDENCE_AUTH_MODE=required` changes the boundary:

- startup fails unless `BETTER_AUTH_URL` is an explicit HTTPS origin, or an explicit `http://127.0.0.1:<port>` origin for local testing;
- startup fails unless `BETTER_AUTH_SECRET` contains at least 32 characters or every `BETTER_AUTH_SECRETS` entry uses the documented `version:value` form with at least 32 value characters;
- HTTPS deployments require `REMEDENCE_PASSWORD_RESET_WEBHOOK_URL` and a 32-character `REMEDENCE_PASSWORD_RESET_WEBHOOK_TOKEN`; reset messages are delivered over an authenticated HTTPS request and reset completion revokes existing sessions;
- HTTPS deployments require MFA by default; `REMEDENCE_REQUIRE_MFA=false` is an explicit deployment opt-out intended for controlled transitions;
- Better Auth handles `/api/auth/*` before Express JSON parsing, as required by its Express integration;
- liveness and readiness probes remain unauthenticated;
- every `/api/v1` route requires a valid database-backed session;
- every product request resolves an active `organization_memberships` row, and a multi-membership user must send `X-Remedence-Organization` for an organization they belong to;
- mutation audit events use the authenticated Better Auth user ID instead of the local-workspace actor; and
- public email/password sign-up is disabled by default;
- TOTP enrollment, backup-code issuance, challenge lockout, and browser challenge screens are enabled;
- OIDC and SAML 2.0 federation use the Better Auth SSO owner, with domain verification, implicit provisioning disabled, correlated SAML requests, required assertion timestamps, and deprecated algorithms rejected; and
- the web application presents a sign-in screen, refreshes durable session state after login/logout, and shows the authenticated account identity.

## Initial owner

Provision the first owner only while the application is stopped, the Better Auth user table is empty, and exactly one organization has been initialized. Supply `REMEDENCE_AUTH_MODE`, `BETTER_AUTH_URL`, Better Auth secret material, the data directory, and `REMEDENCE_BOOTSTRAP_PASSWORD` through the deployment's secret-injection mechanism, then run:

```text
bun run auth:bootstrap --name <owner-name> --email <owner-email>
```

The password is never accepted as a command-line argument and is removed from the bootstrap process environment before database work begins. Provisioning refuses to run after any user exists, hashes the credential through Better Auth, creates the user's active Owner membership, and deletes the bootstrap-created session so the owner must perform a normal sign-in. If membership persistence fails, the partially created user is removed. Remove `REMEDENCE_BOOTSTRAP_PASSWORD` from the deployment environment immediately after the command exits.

Sessions expire after eight hours and are eligible for refresh after one hour. Cookie session caching is disabled so revocation is checked against durable session state. HTTPS configurations force secure cookies. Password-reset links expire after 30 minutes. The delivery webhook receives a `password-reset` template request, recipient identity, action URL, and expiry; it must return a successful HTTP status within ten seconds. Do not log webhook request bodies because the action URL contains a one-time credential.

Only active Owners and Administrators may register, update, or delete SSO providers. Provider credentials and certificates are retained in the Better Auth `ssoProvider` table; production database encryption and deployment secret management remain required. IdP-initiated SAML is disabled. Configure providers through the Better Auth SSO endpoints, then users can select **Continue with SSO** using their work email.

## Secret rotation

Prefer `BETTER_AUTH_SECRETS` for non-destructive rotation. The first entry is the active encryption key and remaining entries are decryption-only historical keys, for example `2:<new-value>,1:<old-value>`. Secret values are deployment-owned and must never be committed, logged, included in support bundles, or returned from readiness endpoints.

## Remaining authentication work

Public sign-up remains closed. A role-controlled invitation and membership-administration workflow and an external production secrets manager are still required before authentication can be treated as a complete hosted-product lifecycle.
