# Privacy lifecycle

Tenant privacy operations are authenticated, tenant-derived, role-restricted, and recorded through production stores.

## Export

Owners and administrators can download `/api/v1/privacy/export`. The export contains tenant workflow records, safe user profile fields, public integration configuration, and base64 evidence bytes. Password/account records, sessions, SSO secrets, connector ciphertext, malware receipts, object-store keys, and encryption keys are excluded. Every artifact is re-hashed during export; one mismatch rejects the complete export.

## Retention and legal holds

Evidence uploads receive an explicit `retention_until`. `bun run worker:privacy` removes only expired, unadopted artifacts without a legal hold. Before deleting database metadata it writes a durable cleanup receipt containing the object keys. Object cleanup is idempotent and pending receipts are retried after restart.

Owners and administrators can apply or release an artifact legal hold through `/api/v1/privacy/artifacts/{artifactId}/legal-hold`. Hold changes are audited. A legal hold exempts an artifact from retention and blocks tenant deletion.

## Tenant offboarding

Only an owner can call `/api/v1/privacy/delete-tenant`, and the body must exactly confirm `DELETE <authenticated-organization-id>`. The operation:

1. rejects any active legal hold;
2. journals evidence object keys in a deletion receipt outside the tenant foreign-key graph;
3. deletes tenant records in dependency order in one database transaction;
4. removes evidence objects and marks the receipt complete;
5. returns `202 Pending object cleanup` if object removal fails, allowing the privacy worker to retry.

Deletion receipts retain only a SHA-256 organization digest, requesting principal ID, object keys needed for cleanup, status, and timestamps. Durable idempotency tombstones may remain until their normal short expiry so an offboarding retry cannot recreate or ambiguously repeat the operation.

Audit history is available only to owners and administrators. Tenant deletion removes tenant audit events; the non-tenant deletion receipt is the minimal offboarding proof retained for cleanup and verification.
