# Verification worker

Verification runs are currently bound to an authenticated user session or the trusted local verification process. Remedence derives that identity server-side, rejects self-verification against the remediation principal, binds all subsequent run mutations to the assigned principal, and stores source-revision plus patch-digest provenance.

An isolated queued execution runtime, sandbox policy, cancellation, retries, timeouts, and signed execution receipts remain separate worker-delivery work. The API does not claim that those controls exist yet.
