# Persistent Local Core v1 Design

**Status:** Approved architecture, implementation specification

**Date:** 2026-08-20

**Repository:** `remedence/remedence`

**Implementation branch:** `feat/persistent-local-core-v1`

## 1. Purpose

Remedence currently has a polished local React interface backed by compiled fictional data and component state. The interface demonstrates the intended product rule, but its imports, remediation updates, verification results, evidence state, report state, and metrics do not survive a restart and are not consumed through the canonical API.

This project turns that interface into a real single-node, self-hosted product slice:

```text
finding
→ remediation
→ independent verification record
→ evidence
→ provable closure
```

The core invariant remains:

```text
PATCHED ≠ VERIFIED FIXED
```

A finding may become `Verified fixed` only after a separate verification run passes and the evidence produced by that run is recorded and locked.

## 2. Goals

The first persistent release must provide these outcomes:

1. Findings are stored in a file-backed database and remain after the API restarts.
2. A user can import a finding through the web application and the canonical `/api/v1` contract.
3. Finding identifiers are unique per organization, case-insensitively.
4. Remediation history is persistent and separate from verification history.
5. A user can create a verification run, record individual checks, and complete it as passed or failed.
6. A failed verification remains visible after a later verification passes.
7. A passed verification locks its evidence records and transitions the finding to `Verified fixed` atomically.
8. Dashboard metrics, queues, activity, notifications, and report status are derived from API data rather than React flags.
9. A report snapshot can be generated from stored data and downloaded as Markdown.
10. Every mutation records an append-only audit event.
11. The product remains usable at the approved desktop, tablet, mobile, keyboard, reduced-motion, and 200 percent zoom conditions.
12. The API, web application, future CLI, and future integrations share one OpenAPI 3.1 contract.

## 3. Non-goals

The following work is intentionally outside this implementation slice:

- Multi-user authentication or authorization.
- Internet-facing deployment without an authenticating reverse proxy.
- Arbitrary command execution by a verification worker.
- Unrestricted server-side HTTP verification, which would create an SSRF boundary.
- External webhook delivery.
- Cloud billing, subscriptions, or public pricing.
- AI inference execution.
- Postgres, Redis, Kubernetes, object storage, or a distributed queue.
- Cryptographic notarization outside the local host.
- PDF report generation.
- Automatic migration from third-party security products beyond the normalized manual import contract.
- A separate API repository.

The UI must not describe these deferred capabilities as available.

## 4. Prerequisite repair checkpoint

Before replacing component state with API state, the merged v1 defects found by `codex review` must be fixed with regression tests.

### Platform repairs

- Route each mobile row action using the same action map as desktop rows.
- Reject duplicate finding IDs before insertion, including case variants.
- Make the owner filter affect results.
- Make sort options affect ordering.
- Trap keyboard focus inside drawers and dialogs.
- Make the application behind an open modal inert.
- Replace SEC-1042's active failure notification after it is resolved.
- Either apply global search to the active page or clearly scope it to the dashboard. This design chooses global search across persisted companies and findings.
- Add repository line-ending policy with `.gitattributes` so a fresh Windows worktree passes Prettier checks when the user's global Git configuration uses `core.autocrlf=true`.

### Public site repairs

These belong in a separate `remedence.github.io` fix branch and must be completed before the later product-copy update:

- Align the JavaScript mobile-navigation resize threshold with the CSS `1120px` transition.
- Treat HTTP 4xx and 5xx responses as application request failures in Playwright, not only transport failures.

### Organization profile repair

The `.github` organization profile must replace malformed symbols in `PATCHED ≠ VERIFIED FIXED` and `Remediate → Verify → Prove`, then point to the live site and canonical repository without expanding into a landing page.

## 5. Architecture

The first real product runs as one API process plus the existing web application:

```text
React web application
        ↓ generated OpenAPI client
/api/v1
        ↓ OpenAPI request and response validation
Express 5 route handlers
        ↓ domain services and state-transition rules
repository interfaces
        ↓
node:sqlite file-backed database
        ↓
audit events, verification history, evidence, reports
```

The web development server proxies `/api` to the local API. Production local mode serves the built web assets from the API process so browser requests remain same-origin.

The service binds to `127.0.0.1` only. Remote unauthenticated binding is not part of v1.

## 6. Runtime and dependency policy

### Runtime floor

- Supported runtime: Node.js `>=24.15.0 <27`.
- CI validates Node.js 24 LTS and Node.js 26 Current.
- `node:sqlite` is used behind repository interfaces. Node.js 24.15 promoted it to release-candidate stability, and Node.js 24 is the production LTS line during this implementation.

### API dependencies

- Express 5 for HTTP routing and middleware.
- `express-openapi-validator` version 5.5 or newer for OpenAPI 3.1 request validation and JSON response validation.
- `yaml` for migration and contract tooling only where a parser is required.
- `openapi-typescript` to generate TypeScript contract types.
- `openapi-fetch` for the browser client.

No ORM is introduced. SQL stays inside `packages/database`, behind focused repositories. This avoids coupling domain logic to one persistence library and keeps a future Postgres adapter possible.

## 7. Monorepo boundaries

### `apps/api`

Owns process startup, HTTP middleware, OpenAPI validation, routes, dependency composition, structured request logging, and graceful shutdown.

Proposed structure:

```text
apps/api/
  package.json
  tsconfig.json
  src/
    app.ts
    server.ts
    config.ts
    dependencies.ts
    middleware/
      request-context.ts
      problem-handler.ts
    routes/
      dashboard.ts
      companies.ts
      findings.ts
      imports.ts
      remediations.ts
      verifications.ts
      evidence.ts
      reports.ts
      audit-events.ts
  test/
    api.test.ts
    restart-persistence.test.ts
```

### `packages/core`

Owns domain entities, state transitions, service interfaces, repository ports, errors, priority calculation, and report snapshot calculation. It must not import Express or SQLite.

```text
packages/core/
  package.json
  tsconfig.json
  src/
    domain/
      entities.ts
      finding-state.ts
      priority.ts
    errors/
      domain-error.ts
    ports/
      repositories.ts
      clock.ts
      id-generator.ts
    services/
      import-finding.ts
      remediation-service.ts
      verification-service.ts
      dashboard-service.ts
      report-service.ts
    index.ts
  test/
```

### `packages/database`

Owns the SQLite connection, migrations, transactions, row mapping, and repository implementations.

```text
packages/database/
  package.json
  tsconfig.json
  migrations/
    0001_initial.sql
  src/
    database.ts
    migrations.ts
    transaction.ts
    repositories/
      company-repository.ts
      finding-repository.ts
      remediation-repository.ts
      verification-repository.ts
      evidence-repository.ts
      report-repository.ts
      audit-event-repository.ts
    seed.ts
    index.ts
  test/
```

### `packages/evidence`

Owns evidence metadata normalization, evidence content hashing, and lock validation. It does not store files in v1.

### `packages/verification`

Owns verification-run and verification-check data contracts that are independent from an eventual worker implementation. No process execution or outbound network access is added.

### `apps/web`

Owns presentation, interaction state, API loading and mutation state, accessibility behavior, and responsive layout. It must not contain authoritative workflow transitions.

The current large `App.tsx` is split only along real product boundaries:

```text
apps/web/src/
  app/
    App.tsx
    AppShell.tsx
    navigation.ts
  features/
    dashboard/
      DashboardPage.tsx
    findings/
      FindingQueue.tsx
      FindingAction.ts
    imports/
      ImportFindingDialog.tsx
    remediation/
      RemediationPanel.tsx
    verification/
      VerificationDrawer.tsx
    evidence/
      EvidencePage.tsx
    reports/
      ReportDialog.tsx
  lib/
    api/
      client.ts
      schema.d.ts
    dialogs/
      useDialogFocus.ts
    formatting/
      format.ts
```

The generated OpenAPI schema remains generated code. Hand-written UI types must not duplicate the API contract.

## 8. Database configuration

The default database path is:

```text
./data/remedence.db
```

It can be changed with `REMEDENCE_DATA_DIR`. The API creates the directory when absent.

The database opens with these protections:

- Foreign keys enabled.
- Defensive mode enabled.
- Extension loading disabled.
- Unknown named parameters rejected.
- A five-second busy timeout.
- WAL journal mode.
- `synchronous=NORMAL` for the local single-node balance.
- Explicit limits for SQL length, bound variables, expression depth, and attached databases.
- Prepared statements or `SQLTagStore` bindings for all user-controlled values.
- Transactions for every multi-table mutation.

Migration state is stored in `schema_migrations`. Migrations are ordered SQL files and are applied in one transaction at startup. A failed migration aborts startup without partially advancing the schema version.

## 9. Persistent data model

All timestamps are UTC ISO 8601 strings. Public identifiers are stable strings. Internal relation identifiers use UUIDs generated by the application.

### Organizations

Fields:

- `id`
- `name`
- `slug`
- `created_at`
- `updated_at`

The seed creates Harborline Technology Group as the initial organization.

### Companies

Fields:

- `id`
- `organization_id`
- `name`
- `risk_score`
- `risk_level`
- `created_at`
- `updated_at`

### Findings

Fields:

- `id`, internal UUID
- `organization_id`
- `company_id`
- `finding_key`, such as `SEC-1042`
- `title`
- `description`
- `source`
- `severity`
- `state`
- `owner`
- `asset_name`
- `detected_at`
- `sla_due_at`
- `created_at`
- `updated_at`

A unique index on `(organization_id, finding_key COLLATE NOCASE)` prevents case-variant duplicates.

### Remediations

Fields:

- `id`
- `finding_id`
- `status`, one of `In progress`, `Completed`, `Cancelled`
- `summary`
- `reference`
- `owner`
- `started_at`
- `completed_at`
- `created_at`
- `updated_at`

### Verification runs

Fields:

- `id`
- `finding_id`
- `remediation_id`
- `status`, one of `Queued`, `Running`, `Passed`, `Failed`, `Cancelled`
- `method`
- `worker_name`
- `scope`
- `result_summary`
- `started_at`
- `completed_at`
- `created_at`

### Verification checks

Fields:

- `id`
- `verification_id`
- `sequence`
- `name`
- `status`, one of `Pending`, `Passed`, `Failed`, `Skipped`
- `message`
- `created_at`

### Evidence items

Fields:

- `id`
- `finding_id`
- `verification_id`
- `kind`
- `label`
- `source_reference`
- `content_hash`
- `metadata_json`
- `created_at`
- `locked_at`

Locked evidence cannot be updated or deleted through v1 repositories. V1 records metadata and hashes, not large file contents.

### Reports

Fields:

- `id`
- `company_id`
- `title`
- `period_label`
- `status`, one of `Draft`, `Ready`
- `snapshot_json`
- `generated_at`
- `created_at`

A report is an immutable snapshot. Regenerating creates a new report row rather than silently rewriting historical output.

### Audit events

Fields:

- `id`, increasing integer
- `organization_id`
- `actor_type`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `details_json`
- `occurred_at`

Application repositories expose insert and read operations only. V1 does not claim that a person with direct filesystem access cannot alter the SQLite file.

## 10. Finding state machine

Allowed transitions are explicit domain rules:

```text
Import
  → Needs remediation

Needs remediation
  → Remediating

Verification failed
  → Remediating

Remediating
  → Awaiting verification

Awaiting verification
  → Verification failed

Awaiting verification
  → Verified fixed
```

Rules:

- Import cannot create `Verified fixed`.
- Completing remediation never creates `Verified fixed`.
- A verification can start only after at least one completed remediation exists.
- A passed verification must have no failed or pending required checks.
- A failed verification must contain a concrete result summary.
- Completing a verification as passed, creating and locking evidence, updating the finding, and recording audit events occur in one transaction.
- A later passed verification does not delete or mutate earlier failed runs.
- V1 does not reopen a `Verified fixed` finding. A reopen operation is deferred until its semantics are designed.

## 11. Priority ordering

The API returns queue items in this order by default:

1. Verification failed.
2. Critical awaiting verification.
3. SLA breached.
4. Critical or high needing remediation.
5. Remaining open findings.
6. Verified fixed findings when explicitly included.

Ties are ordered by SLA due time, then detection time, then finding key. The priority calculation lives in `packages/core`, is covered by unit tests, and is reused by the API and report calculations.

## 12. API contract

The canonical base path remains `/api/v1`. `api/openapi.yaml` is changed before handler implementation, and generated client types are committed so contract changes are reviewable.

### Health

`GET /healthz`

Returns process readiness, database readiness, and schema version. It contains no secrets or filesystem paths.

### Dashboard

`GET /api/v1/dashboard`

Returns:

- Metric summary.
- Prioritized action queue.
- Company risk overview.
- Recent verification activity.
- Current notification items.
- Latest report status.

Optional queue query parameters mirror finding filters.

### Findings

`GET /api/v1/findings`

Supports:

- `search`
- `company_id`
- `state`
- `severity`
- `owner`
- `sort`, one of `priority`, `newest`, `sla`
- `include_verified`
- `page`
- `page_size`, maximum 100

`GET /api/v1/findings/{findingId}` returns the finding plus remediation, verification, evidence, and audit summaries needed by its detail surface.

### Imports

`POST /api/v1/imports`

Accepts one normalized finding in v1. It returns `201` with the import record and finding. A duplicate organization and finding-key pair returns `409` using `application/problem+json`.

### Remediation

`POST /api/v1/remediations`

Creates an in-progress remediation and transitions an eligible finding to `Remediating`.

`POST /api/v1/remediations/{remediationId}/complete`

Records completion details and transitions the finding to `Awaiting verification`.

### Verification

`POST /api/v1/verifications`

Creates a run with its expected check names and transitions the run to `Running`.

`POST /api/v1/verifications/{verificationId}/checks`

Records one check result. Reusing a sequence number returns `409`.

`POST /api/v1/verifications/{verificationId}/complete`

Completes the run as `Passed` or `Failed`.

For `Passed`, the request includes evidence metadata. The service validates the checks, creates and locks evidence, updates the finding, and records audit events atomically.

For `Failed`, the service requires a failure summary and transitions the finding to `Verification failed`.

### Evidence

`GET /api/v1/evidence`

Filters by `finding_id`, `verification_id`, and lock status.

`GET /api/v1/evidence/{evidenceId}` returns immutable evidence metadata.

### Reports

`POST /api/v1/reports`

Creates a report snapshot for one company and period label.

`GET /api/v1/reports/{reportId}` returns report metadata and snapshot data.

`GET /api/v1/reports/{reportId}/download` returns a Markdown representation using `text/markdown; charset=utf-8` and a safe filename.

### Audit events

`GET /api/v1/audit-events`

Filters by entity type, entity ID, and time range. Results are ordered by increasing event ID for a defensible sequence.

## 13. Problem responses

Errors use `application/problem+json` with:

- `type`
- `title`
- `status`
- `detail`
- `instance`
- `code`
- `request_id`
- `errors` for field-level validation when applicable

Status behavior:

- `400` for malformed or contract-invalid requests.
- `404` for absent resources.
- `409` for duplicates, invalid state transitions, and conflicting sequence numbers.
- `413` for request bodies over 256 KiB.
- `500` for unexpected failures, without stack traces or local paths in the response.

Every response includes `X-Request-ID`. Logs use the same request ID.

## 14. Local security boundary

The API is deliberately local-first:

- Listen on `127.0.0.1` only.
- Do not enable permissive CORS.
- Require JSON content type for JSON mutations.
- Limit JSON bodies to 256 KiB.
- Reject unknown request fields through OpenAPI validation where the schema sets `additionalProperties: false`.
- Never construct SQL from user-supplied strings.
- Never load SQLite extensions.
- Never accept a filesystem path from an API caller.
- Never fetch an arbitrary URL in v1.
- Never execute a shell command in v1.
- Redact stack traces, database paths, and environment values from HTTP errors.
- Store no passwords, API keys, cookies, tokens, or OAuth material.

The README must state that v1 local mode has no user authentication and must not be exposed directly to an untrusted network.

## 15. Web application data flow

At startup:

```text
App shell loads
→ GET /api/v1/dashboard
→ render metrics, queue, activity, notifications, report state
```

For a mutation:

```text
user submits written form
→ API mutation
→ visible pending state
→ success or problem response
→ invalidate and reload affected read models
→ written aria-live result
```

The web application does not optimistically mark a finding verified before the API transaction succeeds.

### Review-finding action behavior

A shared action resolver maps state to behavior for both desktop and mobile:

- `Verification failed` → open finding history.
- `Awaiting verification` → open verification drawer.
- `Needs remediation` → open remediation panel.
- `Remediating` → open remediation history.
- `Verified fixed` → open evidence page.

### Search and filters

Global search updates the URL query string and searches persisted company names, finding keys, titles, sources, owners, and asset names. Page-specific filters also live in URL parameters so refresh and browser navigation preserve the current queue.

### Dialog accessibility

A shared dialog hook:

- Stores the trigger.
- Moves focus to the first useful control.
- Traps Tab and Shift+Tab.
- Closes on Escape when allowed.
- Makes the background application inert.
- Restores focus to the trigger.
- Preserves visible focus styles.

## 16. Seed behavior

`npm run db:seed` creates the approved Harborline dataset only when the target database contains no organizations.

The seed includes:

- Harborline Technology Group.
- Twelve companies, with the three featured companies fully populated.
- SEC-1042 and the other approved queue findings.
- SEC-1042's failed first verification.
- The remediation that covers the secondary path.
- No passed second verification by default, so the user can complete the principal workflow.

Seeding is idempotent. It does not overwrite user data.

## 17. Operations

Root scripts:

- `npm run dev` starts API and web development servers with bounded child-process cleanup.
- `npm run build` builds packages, API, and web.
- `npm run start` starts the production local server and serves built web assets.
- `npm run db:migrate` applies migrations to the configured data directory.
- `npm run db:seed` seeds an empty database.
- `npm run db:backup -- --output <file>` creates a SQLite backup outside the live database file.
- `npm run generate:api` regenerates browser contract types.
- `npm run check` runs formatting, lint, typecheck, unit, integration, build, and end-to-end checks.

Startup logs report only:

- Version.
- Bind URL.
- Schema version.
- Whether the seed was applied.
- Request IDs and structured request outcomes.

## 18. Testing strategy

### Domain tests

Cover:

- Every allowed and rejected finding transition.
- Priority ordering.
- Duplicate import normalization.
- Passed-verification preconditions.
- Failed-run history preservation.
- Report snapshot calculations.

### Database tests

Use temporary file-backed databases and cover:

- Migration from empty database.
- Restart persistence.
- Case-insensitive uniqueness.
- Foreign-key enforcement.
- Transaction rollback when evidence creation fails.
- Locked evidence update rejection.
- Seed idempotency.
- Backup creation and readable restore.

### API tests

Cover:

- OpenAPI request validation.
- OpenAPI JSON response validation.
- `application/problem+json` behavior.
- Body-size enforcement.
- Request ID propagation.
- Filtering, sorting, and pagination.
- Remediation and verification workflow.
- Report download headers and content.

### Web tests

Cover the Codex review regressions and API-backed states:

- Mobile actions route to the correct surface.
- Owner and sort controls change results.
- Duplicate imports show the `409` corrective message.
- Focus remains in a modal.
- Background content is inert.
- Notifications resolve after verification passes.
- Global search works away from Dashboard.
- API failures produce written retry states.

### Browser pre-flight

Playwright validates:

- 1440×900.
- 1280×800.
- 1024×768.
- 430×932.
- 390×844.
- Keyboard order and visible focus.
- Escape behavior.
- 200 percent browser zoom.
- Reduced motion.
- No horizontal overflow.
- No serious automated axe violations.
- No console errors.
- No transport failures or HTTP 4xx/5xx caused by the implementation.
- Persistence across API restart.

### Performance and quality

Production builds target:

- Lighthouse Performance 90 or higher.
- Accessibility 100 where feasible.
- Best Practices 95 or higher.
- SEO 95 or higher for the public site.

Actual scores are reported rather than hidden.

## 19. Review workflow

Implementation is divided into independently testable checkpoints. Each checkpoint ends with:

```text
focused tests
→ full repository checks
→ microscopic commit
→ codex review against the checkpoint base
→ fix all P1 and P2 findings
→ browser validation when UI behavior changed
```

Before merge:

- Review the complete diff against `origin/main`.
- Run `codex review --base origin/main`.
- Confirm no secrets or personal files.
- Confirm the database and generated test artifacts are ignored.
- Run the complete `npm run check` suite.
- Run Design & Taste critique, refinement, and pre-flight for changed product surfaces.
- Push the feature branch and open a PR.
- Merge only after all checks and final browser validation pass.

## 20. Deferred subprojects

The next independent architectural projects are:

1. Isolated verification workers with an explicit capability model, egress controls, cancellation, and evidence ingestion.
2. Authentication, organization membership, role-based authorization, and secure remote binding.
3. Managed integrations and webhook delivery.
4. Postgres persistence and multi-node deployment when operational scale requires it.
5. Cryptographically signed evidence manifests and external notarization.
6. CLI and SDK extraction after the API has a second real consumer.
7. Hosted Remedence Cloud operations.

## 21. Source references

- Node.js 24 LTS release schedule and production support guidance: Node.js Releases.
- `node:sqlite` release-candidate status, defensive mode, foreign keys, limits, prepared statements, and backup API: Node.js SQLite documentation for the latest Node.js 24 LTS release.
- OpenAPI 3.1 request and JSON response validation with Express 5: `express-openapi-validator` official repository.
- Generated OpenAPI TypeScript types and fetch client: OpenAPI TypeScript and `openapi-fetch` official documentation.
