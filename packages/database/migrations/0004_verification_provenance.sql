ALTER TABLE remediations
ADD COLUMN remediator_principal_id TEXT NOT NULL DEFAULT 'legacy-unattributed';

ALTER TABLE verification_runs
ADD COLUMN verifier_principal_id TEXT NOT NULL DEFAULT 'legacy-unattributed';

ALTER TABLE verification_runs
ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'legacy-assertion';

ALTER TABLE verification_runs
ADD COLUMN execution_source TEXT NOT NULL DEFAULT 'legacy-untrusted';

ALTER TABLE verification_runs
ADD COLUMN source_revision TEXT NOT NULL DEFAULT 'legacy-unavailable';

ALTER TABLE verification_runs
ADD COLUMN patch_digest TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
