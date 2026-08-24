# Release and deployment model

Remedence currently ships one product mode: **local beta**. Supported self-hosted and hosted multi-tenant modes are planned release targets, not aliases for the local process and not current production claims.

## Mode matrix

| Mode                       | Status                             | Network boundary                                                       | Identity and tenancy                                                                                     | Persistence                                                                                   | Support claim                             |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Local beta                 | Implemented                        | API fixed to `127.0.0.1`; optional separate local worker process       | Explicit local-workspace trust or required accounts, sessions, MFA, federation config, and tenant roles  | Local SQLite plus protected artifact directory and durable job queue                          | Evaluation and local workflow use only    |
| Single-host container beta | Implemented                        | Caddy TLS edge; authenticated API network binding                      | Required accounts, MFA policy, federation configuration, and tenant roles                                | Single-host SQLite volume, protected artifact directory, ClamAV, and durable workers          | Evaluation and controlled single-host use |
| Supported self-hosted      | Planned and blocked by gates below | TLS-terminating trusted proxy plus an authenticated application origin | Authenticated principals, secure sessions, recovery, MFA, tenant-scoped RBAC                             | Supported production database adapter and object storage                                      | None until every self-hosted gate passes  |
| Hosted multi-tenant SaaS   | Planned and blocked by gates below | Managed public edge and isolated internal worker/data planes           | Managed identity lifecycle, tenant isolation, administration boundaries, enterprise federation direction | Managed production database, encrypted object storage, queues, backups, and disaster recovery | None until every SaaS gate passes         |

The server remains loopback-only by default. `REMEDENCE_API_HOST=0.0.0.0` fails closed unless required authentication uses an HTTPS application origin; the supplied deployment publishes only the Caddy TLS edge.

## Self-hosted release gates

A release cannot be called supported self-hosted until current evidence demonstrates all of the following through production interfaces:

- account enrollment, secure session issuance and revocation, recovery, MFA, and an explicit OIDC/SAML support decision;
- organization membership and role checks derived from the authenticated principal on every read and mutation, including negative cross-tenant tests;
- verifier-independence policy using durable remediator identity, verifier identity and credential source, and patch provenance;
- trusted-proxy configuration, TLS deployment guidance, security headers, same-origin/CSRF controls, bounded requests, timeouts, safe errors, rate limits, and quotas;
- a supported production database adapter with pooling, transactional migrations, concurrency tests, tenant-safe keys/indexes, backup/restore drills, and a documented rollback path;
- secret ownership outside source control, encryption-key hierarchy, rotation and revocation procedures, and startup validation that fails closed;
- durable evidence artifacts, isolated verification workers, observable queues, and operational receipts;
- supported-version policy, vulnerability handling, monitoring, SLOs, and support channels.

Putting a reverse proxy in front of the current local process does not satisfy these gates.

## Hosted SaaS release gates

Hosted multi-tenant SaaS inherits every self-hosted gate and additionally requires:

- independently reviewed tenant isolation for application, database, cache, queue, object-storage, logs, metrics, backups, exports, and support access;
- control-plane and data-plane administration separation, audited break-glass access, tenant offboarding, legal holds, and deletion verification;
- isolated verification workers with per-tenant quotas, sandboxing, cancellation, retry/dead-letter handling, and signed execution receipts;
- managed availability, capacity, incident response, disaster recovery, data residency, subprocessor, and service-level policies;
- staged rollout and rollback evidence for application, schema, workers, integrations, and key rotation.

No hosted runtime or hosted control plane is implemented in this repository today.

## Threat boundaries

Local beta trusts the local machine and OS user. It does not defend against another process or user with access to that account, a malicious browser extension, local database access, or an attacker who can reach a mistakenly proxied port.

Supported self-hosted must treat browsers, imported payloads, integration callbacks, verification artifacts, workers, and the network outside the trusted proxy as untrusted. The operator owns infrastructure and identity-provider configuration; Remedence must still enforce authenticated tenant and role decisions internally.

Hosted SaaS must additionally treat tenants as mutually hostile and operator access as privileged and auditable. Tenant identity must be derived from the authenticated principal, never from a caller-selected organization header or request field.

## Release naming

- `0.x` releases are local-beta releases unless a release note explicitly states that every gate for another mode passed.
- Semantic-version tags, changelog entries, deployment images, or hosted endpoints alone do not upgrade the support mode.
- Each release record must identify implemented mode, schema version, migration/rollback requirements, security-impacting changes, validation evidence, and known limitations.
