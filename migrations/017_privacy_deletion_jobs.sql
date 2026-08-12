CREATE TABLE governance_deletion_tombstones (
  tenant_id text NOT NULL, repository_id text NOT NULL, request_id text NOT NULL,
  requested_at timestamptz NOT NULL, policy_epoch bigint NOT NULL CHECK(policy_epoch>0), state text NOT NULL CHECK(state IN ('ACTIVE','COMPLETED')),
  completed_at timestamptz, PRIMARY KEY(tenant_id,repository_id), UNIQUE(tenant_id,request_id)
);
CREATE TABLE governance_deletion_jobs (
  tenant_id text NOT NULL, repository_id text NOT NULL, request_id text NOT NULL, category text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','COMPLETED')), attempts integer NOT NULL DEFAULT 0,
  result jsonb, updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(tenant_id,repository_id,request_id,category),
  FOREIGN KEY(tenant_id,repository_id) REFERENCES governance_deletion_tombstones(tenant_id,repository_id) ON DELETE RESTRICT
);
CREATE TABLE governance_deletion_receipts (
  tenant_id text NOT NULL, repository_id text NOT NULL, request_id text NOT NULL, payload jsonb NOT NULL,
  key_id text NOT NULL, signature text NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(tenant_id,repository_id,request_id),
  FOREIGN KEY(tenant_id,repository_id) REFERENCES governance_deletion_tombstones(tenant_id,repository_id) ON DELETE RESTRICT
);
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['governance_deletion_tombstones','governance_deletion_jobs','governance_deletion_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true))',name);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON governance_deletion_tombstones,governance_deletion_jobs,governance_deletion_receipts TO agentics_app;
REVOKE DELETE ON governance_deletion_tombstones,governance_deletion_jobs,governance_deletion_receipts FROM agentics_app;
