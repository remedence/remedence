# Observability Operations Center Design

**Status:** Approved direction, written specification for review

**Date:** 2026-08-24

## Purpose

Give hosted and self-hosted operators a truthful, tenant-aware view of API health, verification work, integration delivery, failure rates, service objectives, and error-budget consumption using OpenTelemetry-compatible telemetry.

## Outcomes

1. API requests, database operations, queue work, verification execution, and integration delivery emit correlated traces and metrics.
2. Operators can inspect queue depth, oldest-job age, worker latency, retry/dead-letter volume, and tenant error rates.
3. Readiness remains a dependency probe; the operations center adds historical and service-level context rather than replacing it.
4. SLOs and error budgets are versioned configuration with written status and auditable changes.
5. Alerts are created from evaluated conditions and handed to the notification engine through a stable internal event contract.

## Architecture

```text
API and workers
-> OpenTelemetry SDK
-> OTLP exporter
-> deployment-owned collector/backend

durable operational snapshots
-> tenant-safe operations API
-> operations center UI
-> alert events
-> notification engine
```

Remedence does not build a proprietary tracing backend. The product emits standard OTLP data and stores only the bounded operational aggregates required for its own operations center, SLO evaluation, and alert history.

## Telemetry model

Required spans:

- inbound HTTP request and route operation
- database query category, without SQL values
- verification job enqueue, claim, execution, cancellation, and completion
- integration delivery attempt
- evidence scan and protected storage operation
- report generation
- notification delivery attempt

Required metrics:

- request count, duration, and 5xx rate
- database operation duration and errors
- queue ready, leased, retrying, cancelled, and dead-letter counts
- oldest ready job age
- verification execution duration and outcome
- integration delivery duration and outcome
- notification delivery duration and outcome
- per-tenant error counts with bounded cardinality

Identifiers, finding titles, emails, tokens, evidence bytes, request bodies, and credential material are excluded from telemetry attributes. Tenant IDs may appear only in the protected product aggregates and must be hashed or omitted from external exporters unless the deployment explicitly enables them.

## SLO model

The first catalog includes:

- API availability
- API successful-request latency
- verification queue start latency
- verification completion success
- integration delivery success
- notification delivery success

Each objective has a name, service, indicator definition, target, rolling window, owner, effective version, and enabled state. Error budget is derived from eligible events; it is never manually edited. Burn alerts use short and long windows to avoid paging on isolated errors.

## Operations API and authorization

- Organization operators see their organization's service health, jobs, and error rates.
- Platform operators may see cross-tenant aggregates only through a separate platform role and route family.
- Tenant users never receive another tenant's identifiers, error samples, or workload volumes.
- Mutating SLOs, alert rules, or telemetry export configuration requires granular permissions and audit events.
- Cursor pagination is required for alert history and incidents.

## Operations center UI

The entry view answers five questions in order:

1. Is the service healthy now?
2. Are customers waiting on queued work?
3. Which service objective is at risk?
4. Which failures need action?
5. What changed recently?

Use compact status bands, trend charts only where time comparison matters, and tables for actionable work. Every chart has a written summary and accessible tabular equivalent. Empty states explain whether there is no work, no telemetry, or an exporter/configuration problem.

## Failure behavior

- Telemetry export is non-blocking and bounded; exporter failure cannot take down request processing.
- Local buffers have explicit size and retry limits. Exhaustion increments a dropped-telemetry metric and structured log.
- Operations API queries fail closed on tenant scope.
- Missing telemetry is displayed as `No telemetry received`, never as healthy.
- Alert evaluation is idempotent and deduplicates repeated evaluations for the same rule window.

## Validation

- Unit tests prove attribute redaction, bounded cardinality, SLO arithmetic, burn-window evaluation, and alert deduplication.
- Integration tests use an in-memory OTLP receiver and verify trace propagation from API request through queued work.
- Tenant-isolation tests prove cross-organization operations reads are unavailable.
- Playwright covers desktop, mobile, keyboard, reduced motion, and no-data/degraded/healthy states.
- Load validation measures instrumentation overhead and records the result without claiming an unmeasured performance target.

## Non-goals

- Replacing Grafana, Datadog, Honeycomb, or another telemetry backend.
- Storing raw request bodies, evidence, secrets, or authentication tokens.
- Claiming high availability solely because dashboards exist.
- Paging external recipients before the notification engine is configured and tested.
