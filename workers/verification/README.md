# Verification worker

`bun run worker:verification` starts the independently deployable queue consumer built at `apps/api/dist/verification-worker.js`. It claims tenant-scoped jobs from the configured durable database with expiring owner leases, executes only administrator-configured profiles, persists retries and dead letters, observes cancellation, and atomically adopts checks, finding state, signed receipt evidence, and queue completion. PostgreSQL claims use row locks with `SKIP LOCKED` so multiple worker processes do not receive the same runnable job.

Profiles come from `REMEDENCE_VERIFICATION_PROFILES_PATH`. Images must be pinned by SHA-256 digest; caller-supplied images and commands are never accepted. Docker execution uses no network, a read-only root filesystem, all capabilities dropped, `no-new-privileges`, and bounded PIDs, memory, CPU, output, and timeout. `REMEDENCE_WORKER_RECEIPT_SIGNING_KEY` is mandatory and must be independent secret material of at least 32 characters.

If Docker, an approved profile, or the signing key is unavailable, the worker fails closed and retries according to the durable job policy. Exhausted jobs enter `Dead letter` and can be explicitly requeued by an owner or administrator; they are never converted into successful verification.
