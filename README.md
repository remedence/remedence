# Remedence

Open-source remediation verification, evidence, and reporting infrastructure for MSPs and security teams.

**Security work. Proven complete.**

Remedence connects findings from heterogeneous security tools to remediation work, a separate persisted verification path, locked evidence, append-only audit history, and immutable client reporting.

`Remediate -> Verify -> Prove`

## What Remedence is

Remedence is the verification and evidence system of record between security findings, remediation work, and defensible closure. Findings and remediations may originate from heterogeneous external tools; Remedence keeps the closure truth separate from whichever tool found or patched the issue.

The core rule is:

```text
PATCH CREATED != PATCH MERGED != FINDING CLOSED

PATCHED
   |
   v
Awaiting verification
   |
   v
Independent persisted verification
   |
   +---- Failed -> retained history -> new remediation
   |
   `---- Passed -> locked evidence -> VERIFIED FIXED
```

A remediation can move a finding to **Awaiting verification**. It cannot move the finding directly to **Verified fixed**. A separate persisted verification result must pass first. Successful verification can then lock evidence that becomes part of the audit and client-proof chain.

## What Remedence is not

Remedence is not intended to replace every scanner, code-remediation agent, RMM, CI security product, offensive-security tool, or future verification provider. Those systems can be upstream sources of findings, remediation records, or verification inputs.

Remedence local v1 does **not** provide autonomous patch generation, hosted SaaS authentication, production multi-user RBAC, managed vendor integrations, or a hosted verification worker fleet.

The supported release model is defined in [`docs/release-model.md`](docs/release-model.md). The current `0.x` product is local beta only; supported self-hosted and hosted multi-tenant modes remain gated future targets.

## Implemented in local v1

- Canonical `/api/v1` OpenAPI 3.1 API.
- Persistent SQLite database with migrations and idempotent Harborline demo seeding.
- Normalized findings and company/customer read models.
- Persistent remediation records and state transitions.
- Persistent verification runs and checks, including retained failed verification history.
- **Verified fixed** only after a persisted verification passes.
- Locked evidence metadata with source reference, SHA-256 content hash, timestamps, and verification linkage.
- Append-only audit events.
- Immutable persisted report snapshots with Markdown download.
- Database backup foundation.
- Typed generated web API client.
- Production local mode where one loopback Node process serves both the built React application and `/api/v1`.
- Process-safe `npm run dev` supervision for the API and Vite child process trees.
- Repository-wide checks and GitHub Actions CI on supported Node releases.

## Planned, not implemented

The current schema has remediation `owner`/`reference` fields and verification `worker_name`/`method`/`scope` fields, plus generic audit actor metadata. It does **not** yet model first-class remediator identity versus verifier identity, an explicit `independent_from_remediator` assertion, patch/commit/PR provenance as structured fields, or external verifier credentials. Those provenance boundaries are a later milestone and should not be inferred from the current schema.

Other planned work includes MSP multi-tenancy with authorization, hosted verification execution, managed integrations, and cross-tool orchestration.

## Security and trust boundary

**Remedence local v1 has no user authentication. It binds to 127.0.0.1 and must not be exposed directly to an untrusted network.**

The local server does not default to `0.0.0.0`. Put authentication and an appropriate trusted boundary in front of Remedence before any future network exposure.

## Requirements

- Node.js `>=24.15.0 <27`
- npm with the repository lockfile

## Install

```text
npm ci
```

## Development

Start the API and Vite development server together:

```text
npm run dev
```

The supervisor owns only the two process trees it creates. API output is prefixed with `[api]` and web output with `[web]`. `SIGINT`/`SIGTERM`, startup failure, or an unexpected child exit trigger cleanup of the owned sibling process tree without globally enumerating or killing unrelated Node processes.

The API remains loopback-only on port `43180` by default. Vite proxies `/api` and `/healthz` to that API during development. Development mode does not serve stale `apps/web/dist` files from the API process.

## Production local mode

Build everything required by the local product:

```text
npm run build
```

Then start the single production-local Node process:

```text
npm run start
```

`npm run start` serves the built React application and the persistent API from one `127.0.0.1` origin. API paths stay inside the API namespace and never fall through to `index.html`; normal client-side GET routes use the SPA fallback. Built hashed assets receive long-lived immutable caching while HTML is `no-cache`.

Environment controls:

- `REMEDENCE_API_PORT` overrides the loopback port with an integer from 1024 through 65535.
- `REMEDENCE_DATA_DIR` overrides the data directory. The default is `./data` relative to the process working directory.
- `NODE_ENV=production` also enables production web serving when the compiled server is started directly instead of through `npm run start`.

## Database lifecycle

The API opens `${REMEDENCE_DATA_DIR}/remedence.db`, applies repository migrations, and applies the Harborline demo seed only when the local organization data is absent. Existing organization data is not overwritten by a later seed attempt.

Explicit maintenance commands:

```text
npm run db:migrate
npm run db:seed
npm run db:backup -- --output <file>
```

`db:backup` reads the live database and refuses to overwrite an existing destination or use the live database path as the destination.

## Reports

Reports are generated through the UI or `POST /api/v1/reports`. Each generation creates a new immutable persisted snapshot; later data changes do not rewrite older snapshots.

The Reports page exposes the current snapshot and a **Download Markdown** link backed by:

```text
GET /api/v1/reports/<report-id>/download
```

The response is a Markdown attachment rendered from that persisted snapshot.

## Quality checks

Run the supported repository check workflow:

```text
npm run check
```

It runs formatting, linting, TypeScript checks, OpenAPI contract tests, workspace tests, the production build, generated-API drift validation, and Playwright end-to-end coverage.

GitHub Actions runs the same `npm run check` workflow on `ubuntu-latest` for Node 24.x and 26.x on pull requests and pushes to `main`, with an isolated runtime data directory and Playwright Chromium installed in CI.

## Architecture

```text
Security tools / scanners / remediators
                  |
                  v
        Canonical Remedence API
                  |
                  v
          Normalized findings
                  |
                  v
          Remediation record
                  |
                  v
       Independent verification
                  |
                  v
           Locked evidence
                  |
                  v
       Append-only audit trail
                  |
                  v
      Immutable client reporting
```

Repository boundaries:

- `apps/web` operator-facing React application consuming the typed API client.
- `apps/api` loopback HTTP service and production static application host.
- `packages/core` domain rules, state transitions, and services.
- `packages/database` SQLite repositories, migrations, seed, and backup boundary.
- `packages/evidence` evidence hashing and provenance boundary.
- `packages/verification` verification contracts.
- `api/openapi.yaml` canonical REST contract used for generated TypeScript types.
- `docs` architecture and demo workflow documentation.

See `docs/architecture.md` and `docs/demo-workflow.md` for the full v1 boundaries and failed-first-verification scenario.
