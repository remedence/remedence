# Enterprise User Administration Design

**Status:** Approved direction, written specification for review

**Date:** 2026-08-24

## Purpose

Add a complete workforce lifecycle around the existing Better Auth users, durable sessions, enterprise SSO providers, and organization memberships without making an identity-provider assertion the sole authority for product access.

## Outcomes

1. Owners and authorized administrators can invite, suspend, reactivate, remove, and review organization members.
2. Users can inspect and revoke their sessions; authorized administrators can revoke organization sessions during offboarding or incident response.
3. SCIM 2.0 supports user and group provisioning, deprovisioning, pagination, filtering, and idempotent retries.
4. Identity-provider groups can map to organization roles through explicit, versioned mappings.
5. Access reviews produce durable campaigns, decisions, evidence, and audit events.

## Existing authority

- Better Auth owns users, linked accounts, credentials, sessions, MFA, and SSO provider records.
- `organization_memberships` owns organization access and current fixed roles.
- Request principals are derived from an active membership in `apps/api/src/authentication.ts`.

The feature extends these authorities. It does not introduce a second user table, session registry, or independent organization-role cache.

## Membership lifecycle

```text
invited -> active -> suspended -> active
                   -> removed
invited -> expired
invited -> revoked
```

- Invitations are tenant scoped, single use, hashed at rest, time limited, and bound to an email and intended role.
- Accepting an invitation requires an authenticated identity with a verified matching email.
- Suspension immediately prevents principal resolution and revokes active organization sessions.
- Removal preserves audit history and review evidence while eliminating current access.
- Repeated invitation, suspension, deprovisioning, and revocation requests are idempotent.

## SCIM boundary

- Implement RFC 7644 `/scim/v2/Users`, `/Groups`, `/ServiceProviderConfig`, `/ResourceTypes`, and `/Schemas` for supported operations.
- Each organization receives separately revocable, hashed bearer credentials with last-used and expiry metadata.
- SCIM credentials grant only SCIM operations for one organization and never authorize product API access.
- User `active=false` suspends membership and revokes organization sessions. It does not erase the Better Auth user or audit history.
- Group membership changes evaluate explicit group-to-role mappings. Unknown groups do not grant access.
- Filters and pagination are bounded and validated. Bulk requests have strict operation and payload limits.
- SCIM responses never expose password hashes, OAuth tokens, MFA secrets, recovery codes, or unrelated memberships.

## Group-to-role mapping

The first implementation maps provider group identifiers to the existing roles: Owner, Administrator, Operator, and Viewer. A mapping includes provider, external group identifier, role, priority, enabled state, effective version, and timestamps.

Conflicts fail closed:

- Owner is never granted by an implicit default.
- Multiple matching mappings choose the least-privileged role unless an explicitly ordered policy says otherwise.
- Removing the last active Owner is rejected.
- Manual temporary exceptions require an expiry and audit reason.

Custom permissions and approval workflows remain a following sub-project; this design keeps its interfaces compatible with that future authority.

## Administration UI

Use one Workforce area with focused views:

- Members
- Invitations
- Groups and mappings
- Sessions
- Access reviews
- Provisioning

The primary table shows identity, role, source, MFA state, status, and last activity. Destructive actions use explicit confirmation text and display their access consequence. The UI distinguishes direct membership, invitation, SSO, and SCIM sources.

## Access reviews

Owners create a review for a bounded set of members and a due date. Reviewers choose Keep, Change role, Suspend, or Remove and record a concise reason. Closing a campaign requires every in-scope member to have a decision or an explicit exception. Execution is separate from review and is idempotent so stale decisions cannot overwrite newer membership state.

## Authorization and concurrency

- Introduce granular permissions for workforce reads and mutations while preserving existing roles as initial permission bundles.
- Every mutable workforce resource has a version and ETag.
- Updates require If-Match; stale changes return 412 without partial mutation.
- Separation-of-duty rules prevent a user from approving their own privileged elevation when approval workflows arrive.

## Failure behavior

- Invitation delivery failure leaves an auditable pending invitation that can be retried or revoked; it never implies delivery.
- SCIM retries return the existing result when the idempotency key and normalized request match.
- Partial group synchronization does not remove existing access until a complete authoritative sync is received.
- Session revocation reports exact completed and failed counts without exposing session tokens.
- Provider or directory outages never silently convert users to local unmanaged accounts.

## Validation

- Tests cover invitation expiry/replay, verified-email matching, last-owner protection, suspension, session revocation, SCIM filtering/pagination, deprovisioning, group conflicts, stale ETags, and tenant isolation.
- Security tests cover bearer credential hashing, token redaction, cross-tenant identifiers, OAuth account-linking boundaries, and fail-closed provider errors.
- Playwright covers the complete admin lifecycle, mobile tables, keyboard controls, confirmations, and screen-reader names.

## Non-goals

- A second identity store.
- Password synchronization through SCIM.
- Automatic access from email-domain matching alone.
- Silent privilege elevation from unrecognized provider groups.
- Full custom-role editing before the custom RBAC sub-project is approved.

