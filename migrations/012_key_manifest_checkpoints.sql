CREATE TABLE key_manifest_checkpoints (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  environment text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  manifest jsonb NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  signer_key_id text NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,repository_id,environment,sequence),
  UNIQUE (tenant_id,manifest_digest)
);
CREATE TABLE key_manifest_heads (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  environment text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (tenant_id,repository_id,environment),
  FOREIGN KEY (tenant_id,repository_id,environment,sequence)
    REFERENCES key_manifest_checkpoints(tenant_id,repository_id,environment,sequence) ON DELETE RESTRICT
);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['key_manifest_checkpoints','key_manifest_heads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true))', table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO agentics_app', table_name);
  END LOOP;
END $$;
REVOKE DELETE ON key_manifest_checkpoints,key_manifest_heads FROM agentics_app;
