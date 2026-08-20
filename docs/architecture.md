# Remedence architecture

Remedence is an open-core, API-first security remediation platform. The core lifecycle is:

`finding -> remediation -> independent verification -> evidence -> provable closure`

A remediation record does not certify itself. A finding reaches **Verified fixed** only after an independent verification run passes and the supporting evidence is recorded.

## Monorepo boundaries

- `apps/web` contains the operator-facing React application.
- `apps/api` is the future HTTP service implementation. Its contract is `api/openapi.yaml`.
- `packages/core` owns shared domain types and state rules.
- `packages/database` owns persistence adapters and migrations.
- `packages/evidence` owns evidence metadata, provenance, and locking semantics.
- `packages/verification` owns verification orchestration contracts.
- `packages/ui` is reserved for reusable product UI primitives after duplication justifies extraction.
- `packages/cli` is the future command-line client consuming the same API.
- `workers/verification` is the future isolated verification worker runtime.
- `integrations` contains source and destination integration adapters.

## API contract

The canonical REST namespace is `/api/v1`. The OpenAPI 3.1 document at `api/openapi.yaml` defines the initial resource families for companies, assets, findings, remediations, verifications, evidence, reports, imports, webhooks, and integrations.

The current v1 web interface uses the approved fictional Harborline Technology Group dataset locally so the UX can be evaluated before backend persistence is implemented. Production API behavior, authentication, multi-tenant authorization, storage, and worker execution are intentionally not represented as complete yet.
