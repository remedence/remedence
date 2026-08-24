# @remedence/database

Dual persistence boundary: hardened SQLite for local single-process workspaces, plus pooled PostgreSQL for production API, authentication, tenant data, idempotency, worker leases, integration delivery, and privacy lifecycle state.

Finding, evidence, and audit collection reads use validated opaque keyset cursors with deterministic tie-breakers. Cursors are scoped to their collection and selected finding sort, so clients cannot accidentally reuse a continuation token against a different ordering. Evidence and audit reads no longer expose unbounded or offset-based traversal.

`idempotency_records` coordinates tenant- and principal-scoped mutation reservations across API processes. Completed 2xx responses are replayable for 24 hours; failed requests release their reservation, while incomplete pending records remain fail-closed rather than risking duplicate execution.

`postgres-migrations/` is the controlled production schema. PostgreSQL transactions pin one pooled client, nested work uses savepoints, and queue claims use row locks with `SKIP LOCKED`. SQLite backup/restore commands remain local-only; production backup and restore use `pg_dump`/`pg_restore` as documented in [`../../deploy/README.md`](../../deploy/README.md).
