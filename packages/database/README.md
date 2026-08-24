# @remedence/database

SQLite persistence boundary for local beta: hardened connections, transactional migrations, repositories, units of work, idempotent seed behavior, online backup, and non-overwriting restore validation.

Finding, evidence, and audit collection reads use validated opaque keyset cursors with deterministic tie-breakers. Cursors are scoped to their collection and selected finding sort, so clients cannot accidentally reuse a continuation token against a different ordering. Evidence and audit reads no longer expose unbounded or offset-based traversal.

This package is the local database adapter. It is not a pooled production database adapter and does not make supported self-hosted or hosted concurrency claims. See [`../../docs/architecture.md`](../../docs/architecture.md) and [`../../docs/backup-restore.md`](../../docs/backup-restore.md).
