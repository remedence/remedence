# Local backup and restore

Remedence local beta provides validated SQLite backup and restore primitives. It does not yet provide scheduled backups, remote replication, retention automation, production disaster recovery, or a guaranteed recovery point objective (RPO) or recovery time objective (RTO).

## Backup

Create backups on storage separate from the live data directory:

```text
bun run db:backup --output <absent-backup-file>
```

The command uses SQLite's online backup operation, refuses the live database path, creates parent directories, and refuses to overwrite an existing file.

## Restore validation

Stop the Remedence process before a recovery drill. Restore into an absent staging destination, never directly over the live database:

```text
bun run db:restore --input <backup-file> --output <absent-staging-database-file>
```

Before copying, restore verifies that the source is a regular SQLite file, has the SQLite file header, passes `PRAGMA integrity_check`, and contains migration history compatible with the repository's current migrations. The destination is created with exclusive-create semantics and is integrity-checked again. An existing destination is never overwritten.

After validation:

1. Start the built API with `REMEDENCE_DATA_DIR` pointing to a temporary directory containing the staged file as `remedence.db`.
2. Confirm `/healthz` reports the expected schema version.
3. Read representative companies, findings, failed verification history, locked evidence metadata, audit events, and immutable reports through `/api/v1`.
4. Record backup timestamp, restore start/end, schema version, record checks, warnings, and operator.
5. Shut down the drill process. Promote the staged file only through an operator-controlled, recoverable file move while the normal API remains stopped.

Do not delete or overwrite the prior live database during a drill. Retain it according to the operator's recovery policy until the restored state is accepted.

## Current recovery objectives

Local beta has no service-level RPO or RTO. Its attainable recovery point is the timestamp of the latest operator-created backup. Recovery time depends on database size, storage, and the operator drill; it has not been load-tested or measured as a product guarantee.

Supported self-hosted and hosted modes require automated encrypted backups, off-site copies, retention and deletion policy, periodic restore drills, measured RPO/RTO, point-in-time recovery where required, alerting, access audit, key recovery, and region/failure-domain procedures before a disaster-recovery claim is made.
