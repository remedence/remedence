# @remedence/database

SQLite persistence boundary for local beta: hardened connections, transactional migrations, repositories, units of work, durable API idempotency records, idempotent seed behavior, online backup, and non-overwriting restore validation.

Finding, evidence, and audit collection reads use validated opaque keyset cursors with deterministic tie-breakers. Cursors are scoped to their collection and selected finding sort, so clients cannot accidentally reuse a continuation token against a different ordering. Evidence and audit reads no longer expose unbounded or offset-based traversal.

`idempotency_records` coordinates tenant- and principal-scoped mutation reservations across API processes. Completed 2xx responses are replayable for 24 hours; failed requests release their reservation, while incomplete pending records remain fail-closed rather than risking duplicate execution.

This package is the local database adapter. It is not a pooled production database adapter and does not make supported self-hosted or hosted concurrency claims. See [`../../docs/architecture.md`](../../docs/architecture.md) and [`../../docs/backup-restore.md`](../../docs/backup-restore.md).
