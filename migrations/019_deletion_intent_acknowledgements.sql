ALTER TABLE governance_deletion_jobs DROP CONSTRAINT governance_deletion_jobs_state_check;
ALTER TABLE governance_deletion_jobs ADD CONSTRAINT governance_deletion_jobs_state_check CHECK(state IN ('PENDING','IN_PROGRESS','COMPLETED'));
ALTER TABLE governance_deletion_jobs ADD COLUMN operation_key text;
ALTER TABLE governance_deletion_jobs ADD COLUMN acknowledgement_digest text CHECK(acknowledgement_digest IS NULL OR acknowledgement_digest ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX governance_deletion_operation_key_unique ON governance_deletion_jobs(tenant_id,operation_key) WHERE operation_key IS NOT NULL;
