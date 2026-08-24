# @remedence/evidence

Protected artifact and provenance boundary.

Evidence bytes enter through `POST /api/v1/evidence/artifacts` as bounded binary input. The API rejects empty or unsafe filenames, scans bytes before storage, writes them to a tenant-separated content-addressed object store, and persists the SHA-256 digest, scan receipt, uploader identity, creation time, one-year retention floor, and legal-hold state. An infected or unavailable scan fails closed and no artifact record is created.

A passed verification must adopt a clean, previously unadopted artifact. Adoption, evidence creation, finding transition, and audit writes share the database transaction. The immutable evidence row stores the artifact digest and an HMAC-SHA-256 signed canonical manifest covering artifact identity, size, media type, scanner receipt, evidence metadata, finding, verification, and lock time. Downloads re-hash stored bytes before release.

Local mode uses the filesystem object-store adapter and an EICAR boundary scanner. Hosted HTTPS mode refuses startup without a 32-character `REMEDENCE_EVIDENCE_SIGNING_KEY` and a reachable ClamAV configuration (`REMEDENCE_MALWARE_SCANNER=clamav`, `REMEDENCE_CLAMAV_HOST`, and optional `REMEDENCE_CLAMAV_PORT`). The local scanner is deliberately not accepted for hosted mode.

Object deletion is not exposed as an unrestricted product mutation. The controlled privacy worker applies retention expiry and tenant-offboarding cleanup only after durable policy selection, honors legal holds, and records cleanup receipts for each object operation.
