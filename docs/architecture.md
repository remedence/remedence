# Remedence architecture

Remedence is an API-first verification and evidence system of record for security remediation. Its durable product rule is:

**PATCHED != VERIFIED FIXED**

The system keeps finding state, remediation state, verification results, locked evidence, audit history, and client report snapshots separate so a patch or remediation record cannot certify itself.

## Production-local topology

```text
Browser
  |
  v
127.0.0.1 single local Node/API process
  |-- built React application
  `-- /api/v1
        |
        v
     Core services
        |
        v
   SQLite repositories
        |
        v
 persistent / immutable records
```

Production serves the built web application and API from one loopback origin. The API owns the `/api/*` namespace before static or SPA fallback handling, so an unknown API path remains a structured Problem response instead of receiving `index.html`.

Static production serving follows this order:

```text
/api/* and /healthz
        |
        v
hashed /assets/*  -> Cache-Control: public, max-age=31536000, immutable
        |
        v
other built static files -> Cache-Control: no-cache
        |
        v
GET browser route -> index.html SPA fallback, Cache-Control: no-cache
```

Non-GET unknown routes do not receive the SPA fallback. Express static-serving and `sendFile` primitives own filesystem resolution instead of concatenating request paths into local paths.

Development is deliberately different: Vite serves the React application and proxies `/api` and `/healthz` to the loopback API. The API does not serve `apps/web/dist` in development mode, preventing stale production assets from becoming development truth.

## Trust boundary

Remedence supports a loopback local-workspace mode and a required-authentication mode. Local mode binds to `127.0.0.1` and treats the operating-system user session as its trust boundary; it must not be exposed directly to an untrusted network. Required mode resolves every product request from a durable Better Auth session and an active organization membership.

The server host remains fixed to loopback rather than accepting an environment-controlled bind address. Required mode currently provides tenant membership isolation and authenticated audit actors, but invitation, recovery, enforced MFA, federated identity, and complete role authorization remain separate gates.

The local HTTP process also applies same-origin mutation checks, browser security headers, no-store API caching, bounded JSON payloads, database-coordinated client and tenant request budgets, safe Problem responses, and server connection/request timeouts. These are local defense-in-depth controls, not a claim of public-edge readiness. See [`http-edge-security.md`](http-edge-security.md).

`/livez` reports only process liveness. Each `/readyz` request executes a live database query, reports database/schema readiness, and returns `503` on dependency degradation; `/healthz` remains its compatibility alias. Structured request logs contain request ID, method, route path without query parameters, status, and duration; application payloads and local database paths are not logged by that middleware.

## Canonical API boundary

`api/openapi.yaml` is the canonical REST contract. `/api/v1` is the canonical application namespace.

```text
Browser React code
      |
      v
generated TypeScript API types/client
      |
      v
     /api/v1
      |
      v
 Express routes + validation
      |
      v
    Core services
```

The browser never opens SQLite directly. UI reads and mutations go through the typed HTTP API. Generated API drift is checked by `bun run check:generated-api` and by the repository-wide `bun run check` workflow.

The web client attaches a UUID `Idempotency-Key` to every mutation. The API fingerprints the operation and canonical request body, scopes the key to the authenticated organization and principal, and coordinates reservations in `idempotency_records`. A completed identical request replays its original response; changed key reuse and overlapping execution fail closed. Entity-changing remediation and verification routes additionally require current `If-Match` ETags to reject stale updates.

## Persistence ownership

`packages/database` owns SQLite access, migrations, repository adapters, seed behavior, and backup mechanics. `apps/api` creates the database dependencies and is the application process that owns the live database connection.

The default runtime location is `./data/remedence.db`; `REMEDENCE_DATA_DIR` can redirect the whole local data directory. Runtime databases, WAL/SHM files, SQLite variants, and backup output directories are ignored by Git.

On API startup:

```text
resolve data directory
      |
      v
open SQLite database
      |
      v
apply migrations
      |
      v
load the configured first-run mode
      |
      v
empty onboarding or explicit Harborline demo choice
      |
      v
create repositories + core services
```

The seed is idempotent with respect to existing local organization data; it does not overwrite an already-populated organization.

## Organization and customer separation

Local mode establishes one configured workspace organization. Required mode derives organization identity from the authenticated user's active membership; a user with multiple active memberships must select one explicitly. Managed companies/customers remain separate records beneath that organization.

```text
Local organization
  |
  |-- Company / customer A
  |     `-- findings -> remediations -> verifications -> evidence
  |
  |-- Company / customer B
  |     `-- findings -> remediations -> verifications -> evidence
  |
  `-- organization audit history
```

Companies, findings, remediations, verification runs and checks, evidence, reports, and audit events carry organization identity. Child foreign keys include that identity, so a relationship cannot cross tenants and identifiers may safely repeat between organizations. Membership roles are persisted, but endpoint-level role authorization is not yet complete.

## Finding state machine

```text
Needs remediation
      |
      v
  Remediating
      |
      v
Awaiting verification
      |
      +-------------------+
      |                   |
      v                   v
    Failed              Passed
      |                   |
      v                   v
Verification failed   Verified fixed
      |                   |
      v                   v
new remediation       locked evidence
```

The important transition boundary is:

```text
remediation completed
        !=
finding verified fixed
```

A completed remediation moves an eligible finding to **Awaiting verification**. Only a passed persisted verification can move it to **Verified fixed**.

## Remediation and verification are separate records

A remediation record currently stores fields including its finding link, status, summary, reference, owner, and lifecycle timestamps.

A verification run separately stores its finding link, remediation link, status, method, `worker_name`, scope, result summary, and timestamps, with ordered verification checks recorded beneath the run.

This separation allows the system to retain a failed verification even when a later remediation and later verification succeed. The earlier failure is not rewritten or erased by eventual closure.

## Evidence locking

A successful verification can create evidence items linked to both the finding and verification. Persisted evidence includes:

- evidence kind and label,
- source reference,
- SHA-256 content hash,
- extensible metadata,
- creation timestamp,
- lock timestamp.

Evidence created by the passed verification path is locked as part of the closure transaction. The evidence hash represents the persisted evidence metadata contract used by local v1; the current schema should not be interpreted as a full signed artifact bundle format.

## Audit history

Audit events are append-only records with organization identity, actor type/id, action, entity type/id, details, and occurrence time. Domain workflows append new events rather than rewriting prior event history.

The generic audit actor fields are useful provenance, but they are not yet first-class remediator-versus-verifier identity semantics.

## Immutable report snapshots

Report generation creates a new persisted snapshot. The snapshot records the client/company review state at generation time and is not recomputed in place when findings later change.

```text
current persisted state
      |
      v
Generate report
      |
      v
new immutable report snapshot
      |
      +--> GET /api/v1/reports/<id>
      `--> GET /api/v1/reports/<id>/download -> Markdown attachment
```

Generating a newer report leaves older snapshots readable and unchanged.

## Backup boundary

`bun run db:backup --output <file>` opens the live database read-only and uses the database backup implementation to create a separate snapshot file. It refuses to use the live database as the destination and refuses to overwrite an existing destination.

Backup is a local operational foundation, not a hosted backup/restore service.

## External-tool neutrality

Remedence is intentionally not coupled to one scanner, patch generator, RMM, repository host, or verifier.

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

Outside systems can evolve independently. A scanner can produce a finding; a code or endpoint tool can produce remediation work; another verification source can later provide verification input. Remedence's durable responsibility is the persisted chain that justifies closure.

## Verification provenance: implemented versus planned

### Implemented

- Finding `source` records the finding source as a string.
- Remediation records have `owner` and `reference` strings.
- Verification runs have a server-derived verifier principal, display name, credential class, execution source, immutable source revision and patch digest, method, scope, remediation linkage, result summary, and checks.
- Evidence records have verification linkage, source reference, content hash, metadata, and lock time.
- Audit records have generic actor type/id and entity/action provenance.
- Remediations persist the authenticated principal that completes the patch. Verification identity comes from the server-established principal; callers cannot submit a verifier label. A run is rejected when its verifier principal matches the remediation principal, and every check/completion must come from the principal bound to the run.

Existing pre-migration records are explicitly marked `legacy-assertion` / `legacy-untrusted`; migration does not claim they acquired trusted provenance retroactively. Local mode uses a server-owned local verification-process principal distinct from the local workspace actor.

### Planned

The current schema does not yet contain first-class fields for:

- independently signed worker execution receipts,
- signed verification artifact bundles,
- cross-tool attestation/orchestration policy.

Production verifier execution remains blocked on an isolated worker runtime and independently signed receipts. Principal independence and patch provenance are enforced by the current API and schema.

Those belong to a later milestone. Documentation and UI must not claim they exist until the persistent schema and contracts actually support them.

## Monorepo boundaries

- `apps/web` owns the operator-facing React application.
- `apps/api` owns the loopback HTTP process, API composition, and production static serving.
- `packages/core` owns shared domain entities, state rules, and application services.
- `packages/database` owns SQLite persistence, migrations, seeding, and backup adapters.
- `packages/evidence` owns evidence hashing/provenance logic.
- `packages/verification` owns verification contracts.
- `api/openapi.yaml` is the canonical REST contract.
- generated TypeScript contracts keep browser code aligned with that API boundary.
- `scripts/dev.mjs` owns process-safe local development supervision.
- Isolated `workers/verification` execution and managed integrations remain future boundaries rather than implemented runtime claims.
