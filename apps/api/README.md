# @remedence/api

Canonical authenticated HTTP API for tenant-scoped findings, remediation, verification, protected evidence, reports, and audit history. Routes and generated clients conform to [`../../api/openapi.yaml`](../../api/openapi.yaml).

Mutation clients may send `Idempotency-Key`. Successful responses are durably retained for 24 hours under the authenticated organization and principal. An identical retry replays the original status, body, `Location`, and `ETag`; a changed payload or operation fails with `IDEMPOTENCY_KEY_REUSED`. In-flight duplicates fail closed. The browser client adds a fresh UUID key to every mutation automatically.
