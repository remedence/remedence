# SEC-1042 demo workflow

The v1 demo is intentionally built around a failed first verification. This is the product rule in concrete form: **patched does not mean verified fixed**.

1. Harborline Technology Group imports `SEC-1042`, a critical SQL injection finding affecting Juniper Ridge Dental's patient-export API.
2. An engineer remediates the primary vulnerable path.
3. Independent verification run 1 fails because a secondary query path remains exploitable.
4. A second remediation covers the secondary path.
5. Independent verification run 2 passes.
6. The evidence bundle is locked and the finding becomes **Verified fixed**.
7. The client report can reflect the verified outcome.

The failed first run remains visible in verification history after the second run passes. Evidence includes the scanner finding, vulnerable-code hash, patch reference, regression test, independent verification result, rescan result, before/after evidence, technician identity, and timestamped audit trail.
