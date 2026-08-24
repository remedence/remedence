# Notification and Escalation Design

**Status:** Approved direction, written specification for review

**Date:** 2026-08-24

## Purpose

Turn important remediation, verification, integration, privacy, identity, and operational events into durable, tenant-scoped notifications with explicit routing, retries, escalation, and delivery evidence.

## Outcomes

1. Email, Slack, Microsoft Teams, PagerDuty, and generic webhook destinations share one provider-neutral delivery contract.
2. Rules can route approaching SLA deadlines, failed verification, dead-letter work, legal holds, integration failures, expiring credentials, access-review deadlines, and SLO burn alerts.
3. Delivery attempts are queued, deduplicated, retried with limits, and moved to a dead letter with a written reason.
4. Operators can acknowledge, resolve, retry, mute, and inspect notifications without claiming external delivery unless a receipt exists.
5. Escalation policies advance only when their condition remains active and the prior stage has not satisfied the policy.

## Architecture

```text
domain or operations event
-> normalized notification event
-> rule evaluation
-> notification occurrence
-> recipient and destination expansion
-> durable delivery queue
-> provider adapter
-> sanitized delivery receipt or dead letter
```

Domain services publish events only after their transaction commits. Rule evaluation and delivery are asynchronous. No product mutation waits for Slack, email, Teams, PagerDuty, or webhook availability.

## Data model

- destination: tenant, provider type, encrypted credential reference, verification state, status, version
- rule: event types, filters, severity, schedule, destinations, template version, enabled state, version
- escalation policy: ordered stages, delay, acknowledgement behavior, repeat limit, version
- occurrence: normalized event identity, tenant, entity reference, rule version, status, opened/resolved timestamps
- delivery: occurrence, destination, attempt, scheduled time, lease, status, response class, receipt digest
- mute: bounded scope, reason, creator, start, expiry

All identifiers are tenant scoped. Raw provider tokens, webhook secrets, and response bodies are never stored in delivery records.

## Event contract

Every event includes:

- stable event ID and type
- organization ID
- occurred-at timestamp
- severity
- bounded entity type and ID
- deduplication key
- template-safe fields
- source audit-event ID or operational-alert ID

Events do not carry evidence bytes, credentials, access tokens, arbitrary HTML, or unbounded logs.

## Rules and escalation

- Rule filters are structured fields, not executable code.
- SLA reminders use persisted due times and fire at configured thresholds.
- Verification failure occurrences remain open until a later successful verification or explicit resolution policy closes them.
- Dead-letter and credential-expiry events deduplicate over a configured window.
- Acknowledgement can stop escalation when the policy says so; it never marks the underlying finding, job, hold, or integration healthy.
- Mutes require a reason and expiry. Permanent silent suppression is unavailable.
- All rule, destination, mute, acknowledgement, retry, and resolution mutations are audited.

## Provider boundaries

- Email uses a deployment-configured provider adapter with verified sender configuration.
- Slack and Teams use signed or OAuth-managed destination credentials stored through the integration encryption boundary.
- PagerDuty sends deduplication keys and records provider event IDs.
- Generic webhooks sign timestamped requests, enforce HTTPS outside loopback tests, validate destination URLs against the SSRF policy, and use replay-resistant delivery IDs.
- Provider adapters classify success, retryable failure, rate limit, authentication failure, and permanent rejection without persisting sensitive bodies.

## Administration UI

The Notifications area contains:

- Inbox: active occurrences and written status
- Rules: event, condition, severity, and routing summary
- Destinations: provider, verification state, last delivery, and health
- Escalations: ordered stages and acknowledgement behavior
- Deliveries: cursor-paginated attempts and dead letters
- Mutes: active scope, owner, reason, and expiry

Rule creation uses a review step that states exactly which events, recipients, and destinations will be affected. Test delivery is clearly labeled and cannot be confused with a live security event.

## Failure behavior

- Delivery is at least once; idempotency and provider deduplication prevent avoidable duplicates.
- Exponential backoff includes jitter, a maximum attempt count, and provider Retry-After support.
- Authentication failures disable the destination after a bounded threshold and open a credential-expiry/integration-failure occurrence.
- Dead-letter retry creates a new attempt linked to the prior failure; it does not rewrite history.
- Rule-evaluation errors create an operator-visible system occurrence and never silently discard the source event.
- Cross-tenant destination or recipient resolution fails closed.

## Validation

- Unit tests cover rule matching, deduplication, escalation timing, acknowledgement behavior, mute expiry, templates, signatures, and failure classification.
- Integration tests use deterministic fake providers for success, timeout, rate limiting, credential rejection, duplicate request, and dead-letter recovery.
- Tenant-isolation tests cover every read and mutation path.
- Playwright covers rule creation, review, test delivery, inbox acknowledgement, dead-letter retry, mobile, keyboard, and non-color status communication.

## Non-goals

- Replacing a PSA, ticketing system, or incident-management platform.
- Sending marketing email or product announcements.
- Executing arbitrary user-authored templates or scripts.
- Treating notification acknowledgement as remediation or verification completion.
- Claiming guaranteed delivery without a provider receipt.

