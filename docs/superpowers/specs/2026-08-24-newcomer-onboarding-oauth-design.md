# Newcomer Onboarding and OAuth Design

**Status:** Approved direction, written specification for review

**Date:** 2026-08-24

**Repository:** `remedence/remedence`

## Purpose

Turn the existing first-launch form and sign-in card into a professional entry experience that gets an authorized newcomer to a useful Remedence outcome without weakening the current authentication and tenant boundaries.

## Outcomes

1. A configured deployment can offer password, enterprise SSO, and selected OAuth/OIDC providers from one coherent sign-in screen.
2. Public account creation remains disabled. A successful external login must resolve an existing account or a pending invitation before a session receives organization access.
3. The initial owner can create the first organization through the existing idempotent onboarding endpoint.
4. A resumable tour explains `PATCHED does not equal VERIFIED FIXED` and guides the user through company, finding, remediation, verification, evidence, and reporting concepts.
5. Empty workspaces show useful next actions instead of fictional metrics or an implicit demo.
6. Users can restart or dismiss the tour from Help. Completion is durable per user and organization.

## Existing authority

- `apps/api/src/authentication.ts` owns Better Auth, durable sessions, MFA, password recovery, and enterprise SSO.
- `apps/api/src/routes/onboarding.ts` owns first-workspace initialization.
- `apps/web/src/features/auth/AuthenticationGate.tsx` owns authentication entry and recovery UI.
- `apps/web/src/features/onboarding/OnboardingGate.tsx` owns first-workspace creation.
- `apps/web/src/app/AppShell.tsx` owns application navigation and tour anchors.

No parallel authentication service, workspace registry, or client-only onboarding source of truth may be introduced.

## OAuth/OIDC boundary

- Start with explicitly configured Google and Microsoft providers because they cover common MSP and enterprise work identities. Provider buttons render only when the server reports a valid configured provider.
- Provider client IDs and secrets are deployment-owned environment secrets. They are never returned to the browser, persisted in product settings, or written to logs.
- Callback URLs are derived from the validated `BETTER_AUTH_URL`; arbitrary per-request callback origins are rejected.
- Authorization requests require state and nonce binding. Callback processing validates issuer, audience, expiry, and signature through Better Auth's provider implementation.
- Account resolution trusts only provider-verified email claims. External identities do not auto-link to an existing password account unless Better Auth can prove the provider account and the configured policy allows that provider.
- A successful provider identity without an active membership or matching pending invitation receives a neutral access-pending screen and no `/api/v1` principal.
- Authentication errors shown to users are generic. Provider details, token claims, authorization codes, and account-existence signals do not enter UI copy or logs.

## Experience flow

```text
sign in
-> resolve authorized identity and organization membership
-> create first organization when no organization exists and user is bootstrap owner
-> choose empty workspace or explicit fictional demo
-> welcome step: explain Remediate -> Verify -> Prove
-> guided workspace tour
-> first useful action
```

The tour is a focused checklist, not a sequence of decorative popovers. Each step names the user outcome, points to one real control, and can be completed by navigating normally. The application must remain usable when the tour is dismissed.

## Persistence

Add tenant-scoped per-user onboarding progress with:

- `organization_id`
- `user_id`
- `tour_version`
- `current_step`
- `status` (`Not started`, `In progress`, `Completed`, `Dismissed`)
- `started_at`, `updated_at`, and `completed_at`
- optimistic `version`

Local unauthenticated mode uses the synthetic local actor only inside its loopback trust boundary. Required-authentication mode always keys progress to the authenticated user and organization.

## API

- Extend authentication status with configured login methods and provider-safe display metadata.
- Add tenant-scoped `GET /api/v1/me/onboarding` and `PATCH /api/v1/me/onboarding` with ETag/If-Match and idempotency protection for repeatable updates.
- Keep `POST /api/v1/onboarding` as the sole organization-initialization mutation.
- Every onboarding state mutation writes an audit event without storing OAuth tokens or claims.

## Interface language

- Sign-in heading: `Sign in to Remedence`.
- Supporting line: `Use your approved work account.`
- Welcome heading: `Security work is not complete until it is verified.`
- Primary action: `Set up your workspace` or `Continue tour`, depending on state.
- Demo option: `Install fictional Harborline demo` with a visible `Demo data` label.

## Accessibility and responsive behavior

- Full keyboard operation, logical focus movement, visible focus, and an explicit Skip tour action.
- Tour progress is written as text and announced through a polite live region after user actions.
- No forced motion; reduced-motion removes transitions without hiding state changes.
- At 390 px width and 200 percent zoom, authentication, setup, and tour actions remain readable without horizontal scrolling.

## Failure behavior

- Authentication-status failure blocks protected content and offers Retry.
- Provider redirect failure returns to sign-in with a generic written error.
- Stale onboarding updates return 412 and reload the server state before another edit.
- Initialization remains idempotent and rejects a second organization creation.
- Dismissing a tour never mutates product data beyond the user's progress record.

## Validation

- Unit and integration tests cover provider visibility, callback-origin validation, unverified email rejection, missing invitation/membership, account-link protection, stale progress, and local-mode behavior.
- Playwright covers password sign-in, mocked OAuth redirect/callback, first workspace creation, tour completion, dismissal, restart from Help, keyboard use, mobile, and 200 percent zoom.
- Browser console, network failures, and serious Axe findings must be clear before completion.

## Non-goals

- Open public sign-up.
- Social identities that do not represent approved work accounts.
- OAuth token storage for third-party product integrations.
- Automatic organization membership based only on email domain.
- A marketing walkthrough disconnected from real product controls.

