# Persistent failed-first verification demo

The flagship Remedence local-v1 story is deliberately a failed first verification. It demonstrates the product rule in persisted application state:

**PATCHED != VERIFIED FIXED**

This is not a simulated UI sequence. The React application reads and mutates the canonical local API, and the resulting finding, remediation, verification, evidence, audit, and report records survive reloads because they are stored in SQLite.

## Scenario

Use the Harborline Technology Group workspace and a finding such as the SEC-1042 authorization/security scenario. The exact finding can be the seeded demo record or a newly imported test finding when validating against an isolated data directory.

1. A persistent finding exists in **Needs remediation**.
2. Open the finding action and record **Remediation #1** with a summary, owner, and remediation reference.
3. Complete Remediation #1. The finding moves to **Awaiting verification**, not **Verified fixed**.
4. Open **Review verification** and create **Verification #1** with its method, verifier/worker name, scope, and required checks.
5. Record at least one required check as **Failed** with a written failure reason.
6. Complete Verification #1 as **Failed**.
7. The finding becomes **Verification failed**.
8. Reload the application. The failed verification result and written reason remain visible from persisted history.
9. Start **Remediation #2** for the same finding and record the new remediation reference.
10. Complete Remediation #2. The finding returns to **Awaiting verification**.
11. Create **Verification #2** linked to Remediation #2 using a separately recorded verification method/worker and scope.
12. Record all required checks as **Passed**.
13. Add evidence metadata, including evidence kind, label, and source reference, then complete Verification #2 as **Passed**.
14. **Only now** does the finding become **Verified fixed**.
15. The successful verification creates locked evidence linked to the finding and verification, with a content hash and lock timestamp.
16. Reopen/reload the finding history and confirm Verification #1 and its failure reason are still preserved alongside the later successful path.
17. Open **Reports**, generate a new client report, and confirm a new immutable persisted report snapshot is created. Use **Download Markdown** to retrieve the snapshot through `/api/v1/reports/<report-id>/download`.
18. Reload or restart the local application and confirm the same finding closure state, verification history, locked evidence, and report snapshot are read back from persistence.

## Why the failed-first path matters

A patch-generation or remediation tool can truthfully say that it produced a change. It cannot, by that fact alone, prove that the security finding is closed.

```text
patch produced
     |
     v
remediation completed
     |
     v
Awaiting verification
     |
     +---- required check fails
     |         |
     |         v
     |   Verification failed
     |         |
     |         v
     |    new remediation
     |
     `---- all required checks pass
               |
               v
          locked evidence
               |
               v
          Verified fixed
```

This is the part an AI patch generator cannot truthfully collapse into "fix generated."

The failed run is valuable evidence too: it proves Remedence did not silently equate the first remediation with closure and did not erase contradictory history once a later remediation succeeded.

## What to inspect during the demo

### Finding state

After Remediation #1 completes, verify the UI says **Awaiting verification** and explicitly does not present the finding as verified fixed. After Verification #1 fails, verify **Verification failed** survives a reload. After Verification #2 passes, verify **Verified fixed** appears only then.

### Verification history

Verification #2 should not replace Verification #1. The finding detail should retain both runs and their checks/result summaries so the failed-first sequence remains auditable.

### Evidence

Open **Evidence** after the successful verification. The proof card should expose the persisted evidence label, Evidence ID, Verification ID, source reference, content hash, creation time, and lock time. Local v1 stores evidence metadata and its hash; this demo should not claim a signed artifact bundle or external verifier credential that the schema does not yet model.

### Reports

Open **Reports** and generate a new report for the chosen company and period. The UI should show the new snapshot ID and provide **Download Markdown**. If an older report exists, its persisted snapshot should remain readable and unchanged after generating the new report.

### Restart persistence

For a production-local validation, stop only the Remedence process started for the isolated demo, restart it against the same `REMEDENCE_DATA_DIR`, and reread the state. The durable truth should come back from SQLite rather than from browser memory.

## Product boundary demonstrated

```text
External finding/remediation source
              |
              v
      Canonical Remedence API
              |
              v
       persistent finding
              |
              v
       remediation record
              |
              v
    persisted verification
              |
              v
        locked evidence
              |
              v
     append-only history
              |
              v
 immutable client snapshot
```

The upstream finding or remediation producer is intentionally replaceable. The demo proves Remedence's own responsibility: keep defensible closure truth separate from the act of creating a patch.
