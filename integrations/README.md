# Integrations

Managed source and destination adapters use tenant-scoped connection records in `packages/database` and runtime providers in `apps/api/src/integration-runtime.ts`.

Implemented providers:

- `scanner-webhook`: inbound finding imports authenticated with an HMAC-SHA256 signature over the exact request bytes and a required stable event ID. Repeated IDs with identical bytes are acknowledged; changed replay payloads fail closed.
- `generic-webhook`: outbound HTTPS JSON with a delivery ID, event type, HMAC-SHA256 body signature, and optional encrypted bearer token.
- `github-issues`: outbound GitHub issue creation with an encrypted token and configurable HTTPS API base.

Credentials are AES-256-GCM encrypted and never returned by the API. Hosted mode requires `REMEDENCE_INTEGRATION_ENCRYPTION_KEYS` as a comma-separated newest-first keyring such as `2:<base64-32-bytes>,1:<base64-32-bytes>`. Local mode creates a mode-0600 key beside the database.

Outbound writes are persisted before execution. `bun run worker:integrations` claims leased jobs, applies a 15-second provider timeout, records only response status and a response digest, retries with bounded exponential backoff, and dead-letters exhausted deliveries. An owner or administrator must explicitly retry a dead letter.
