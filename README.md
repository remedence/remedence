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

Remedence local v1 does **not** provide autonomous patch generation, a supported hosted SaaS deployment, or a managed verification worker fleet. The repository provides required-authentication mode, managed integration connections, and separately deployable integration and isolated-verification workers, but those components do not by themselves satisfy every production release gate.

The supported release model is defined in [`docs/release-model.md`](docs/release-model.md). The current `0.x` product is local beta only; supported self-hosted and hosted multi-tenant modes remain gated future targets.

Authentication implementation status and its fail-closed activation requirements are documented in [`docs/authentication.md`](docs/authentication.md).

Export, retention, legal-hold, and offboarding behavior is documented in [`docs/privacy-lifecycle.md`](docs/privacy-lifecycle.md).

## Implemented in local v1

- Canonical `/api/v1` OpenAPI 3.1 API.
- Persistent SQLite local mode and pooled PostgreSQL production mode with controlled migrations.
- Normalized findings and company/customer read models.
- Persistent remediation records and state transitions.
- Persistent verification runs and checks, including retained failed verification history.
- Durable isolated verification jobs with leases, cancellation, bounded retries, dead letters, digest-pinned Docker profiles, and signed execution receipts.
- Encrypted tenant integration credentials, signed scanner intake, generic HTTPS and GitHub Issues providers, durable deduplicated delivery queues, bounded retries, and dead-letter recovery.
- Tenant export, legal holds, retention enforcement, confirmed offboarding, and durable deletion cleanup receipts.
- **Verified fixed** only after a persisted verification passes.
- Protected evidence artifacts with malware scanning, content-addressed storage, signed manifests, retention/legal-hold policy, and verification linkage.
- Append-only audit events.
- Immutable persisted report snapshots with Markdown download.
- Validated local SQLite backup/restore and documented PostgreSQL dump/restore rollback operations.
- Typed generated web API client.
- Production local mode where one loopback Node process serves both the built React application and `/api/v1`.
- Process-safe `bun run dev` supervision for the API and Vite child process trees.
- Repository-wide checks and GitHub Actions CI on supported Node releases.
- Reproducible digest-pinned container deployment with authenticated network binding, environment preflight, a controlled migration job, health checks, workers, TLS edge, staging promotion, and restore-based rollback.

## Planned, not implemented

The supported container topology uses PostgreSQL, ClamAV, isolated workers, and a Caddy TLS edge. Managed hosted control-plane operations remain a separate release gate. See [`docs/release-model.md`](docs/release-model.md).

## Security and trust boundary

Remedence local mode binds to `127.0.0.1` and uses the operating-system user session as its trust boundary. Required-authentication mode adds durable sessions and active organization membership isolation, but the product must not be exposed publicly until the remaining production gates in `docs/release-model.md` are complete.

The local server does not default to `0.0.0.0`. Put authentication and an appropriate trusted boundary in front of Remedence before any future network exposure.

Local HTTP defense-in-depth and the still-blocked public-edge requirements are documented in [`docs/http-edge-security.md`](docs/http-edge-security.md).

## Requirements

- Node.js `>=24.15.0 <27`
- Bun `>=1.4.0 <2` with the repository lockfile

Bun owns dependency installation, the workspace lockfile, and task orchestration. Node remains the API runtime because local persistence uses `node:sqlite`, which Bun 1.4 does not implement.

## Install

```text
bun ci
```

## Development

Start the API and Vite development server together:

```text
bun run dev
```

The supervisor owns only the two process trees it creates. API output is prefixed with `[api]` and web output with `[web]`. `SIGINT`/`SIGTERM`, startup failure, or an unexpected child exit trigger cleanup of the owned sibling process tree without globally enumerating or killing unrelated Node processes.

The API remains loopback-only on port `43180` by default. Vite proxies `/api` and `/healthz` to that API during development. Development mode does not serve stale `apps/web/dist` files from the API process.

## Production local mode

Build everything required by the local product:

```text
bun run build
```

Then start the single production-local Node process:

```text
bun run start
```

`bun run start` serves the built React application and the persistent API from one `127.0.0.1` origin. API paths stay inside the API namespace and never fall through to `index.html`; normal client-side GET routes use the SPA fallback. Built hashed assets receive long-lived immutable caching while HTML is `no-cache`.

Environment controls:

- `REMEDENCE_API_PORT` overrides the loopback port with an integer from 1024 through 65535.
- `REMEDENCE_DATA_DIR` overrides the data directory. The default is `./data` relative to the process working directory.
- `NODE_ENV=production` also enables production web serving when the compiled server is started directly instead of through `bun run start`.
- `REMEDENCE_AUTH_MODE=required` enables Better Auth and rejects anonymous `/api/v1` access. It requires an explicit `BETTER_AUTH_URL` and at least 32 characters of secret material in `BETTER_AUTH_SECRET` or every versioned `BETTER_AUTH_SECRETS` value. HTTPS deployments also require `REMEDENCE_PASSWORD_RESET_WEBHOOK_URL` plus `REMEDENCE_PASSWORD_RESET_WEBHOOK_TOKEN`, and enforce MFA unless `REMEDENCE_REQUIRE_MFA=false` is explicitly set. Public account creation remains disabled; OIDC and SAML provider management is restricted to Owners and Administrators.
- Hosted HTTPS deployments require protected evidence configuration: a secret `REMEDENCE_EVIDENCE_SIGNING_KEY` of at least 32 characters, `REMEDENCE_MALWARE_SCANNER=clamav`, and `REMEDENCE_CLAMAV_HOST` (with optional `REMEDENCE_CLAMAV_PORT`). The API scans artifact bytes before durable metadata is accepted, signs the immutable evidence manifest, and re-hashes bytes before download. The development-only scanner is never accepted in hosted mode.
- `REMEDENCE_WORKSPACE_MODE=empty` is the default and starts at first-run onboarding without sample records. Set it to `demo` only when Harborline sample data should be installed automatically for a disposable demonstration.

The one-time initial-owner workflow is `bun run auth:bootstrap --name <name> --email <email>`. It requires `REMEDENCE_BOOTSTRAP_PASSWORD` through secure environment injection and refuses to run after any user exists. See the authentication documentation before using it.

Operational probes are `GET /livez` for process liveness and `GET /readyz` for live database/schema readiness. Each readiness request executes a database query and returns `503` with `database: "degraded"` when the dependency is not responsive. `GET /healthz` remains a compatibility alias for readiness. Probe responses are non-cacheable and do not expose local paths.

## Database lifecycle

The API opens `${REMEDENCE_DATA_DIR}/remedence.db` and applies repository migrations. A new default installation stays empty until the onboarding screen creates a named organization or the operator explicitly chooses Harborline demo data. Existing organization data is never overwritten by a later seed attempt.

Explicit maintenance commands:

```text
bun run db:migrate
bun run db:seed
bun run db:backup --output <file>
bun run db:restore --input <backup-file> --output <new-database-file>
```

`db:backup` reads the live database and refuses to overwrite an existing destination or use the live database path as the destination.

`db:restore` validates the SQLite header, full database integrity, and migration compatibility before copying to an absent destination. It never overwrites the live database. Stop the API and follow [`docs/backup-restore.md`](docs/backup-restore.md) for a local recovery drill.

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
bun run check
```

It runs formatting, linting, TypeScript checks, OpenAPI contract tests, workspace tests, the production build, generated-API drift validation, and Playwright end-to-end coverage.

GitHub Actions runs the same `bun run check` workflow on `ubuntu-latest` for Node 24.x and 26.x on pull requests and pushes to `main`, with Bun 1.4.0, an isolated runtime data directory, and Playwright Chromium installed in CI.

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
- `packages/database` local SQLite and pooled PostgreSQL repositories, migrations, queues, and lifecycle stores.
- `packages/evidence` evidence hashing and provenance boundary.
- `packages/verification` verification contracts.
- `api/openapi.yaml` canonical REST contract used for generated TypeScript types.
- `docs` architecture and demo workflow documentation.

See `docs/architecture.md` and `docs/demo-workflow.md` for the full v1 boundaries and failed-first-verification scenario.
