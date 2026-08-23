# @remedence/database

SQLite persistence boundary for local beta: hardened connections, transactional migrations, repositories, units of work, idempotent seed behavior, online backup, and non-overwriting restore validation.

This package is the local database adapter. It is not a pooled production database adapter and does not make supported self-hosted or hosted concurrency claims. See [`../../docs/architecture.md`](../../docs/architecture.md) and [`../../docs/backup-restore.md`](../../docs/backup-restore.md).
