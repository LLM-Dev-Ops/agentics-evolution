CREATE TABLE artifact_manifests (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('STAGED','SEALED','REVOKED','EXPIRED')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  key_id text,
  signature text,
  algorithm text CHECK (algorithm IS NULL OR algorithm='ed25519'),
  retain_until timestamptz NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,manifest_digest),
  UNIQUE (tenant_id,repository_id,artifact_digest)
);
CREATE TABLE artifact_dependencies (
  tenant_id text NOT NULL,
  manifest_digest text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  dependency_digest text NOT NULL CHECK (dependency_digest ~ '^[a-f0-9]{64}$'),
  role text NOT NULL,
  PRIMARY KEY (tenant_id,manifest_digest,ordinal),
  UNIQUE (tenant_id,manifest_digest,dependency_digest),
  FOREIGN KEY (tenant_id,manifest_digest) REFERENCES artifact_manifests ON DELETE RESTRICT
);
CREATE TABLE artifact_status_events (
  tenant_id text NOT NULL,
  manifest_digest text NOT NULL,
  event_version bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('STAGED','SEALED','REVOKED','EXPIRED','LEGAL_HOLD_PLACED','LEGAL_HOLD_RELEASED','DELETED')),
  reason text NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,manifest_digest,event_version)
);
CREATE TABLE artifact_gc_runs (
  tenant_id text NOT NULL,
  run_id uuid NOT NULL,
  cutoff timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('MARKING','SWEEPING','COMPLETED','ABORTED')),
  marked integer NOT NULL DEFAULT 0,
  swept integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id,run_id)
);
CREATE TABLE artifact_gc_candidates (
  tenant_id text NOT NULL,
  run_id uuid NOT NULL,
  manifest_digest text NOT NULL,
  expected_version bigint NOT NULL,
  PRIMARY KEY (tenant_id,run_id,manifest_digest),
  FOREIGN KEY (tenant_id,run_id) REFERENCES artifact_gc_runs ON DELETE CASCADE
);
CREATE INDEX artifact_gc_eligibility_idx ON artifact_manifests(tenant_id,retain_until,updated_at) WHERE legal_hold=false AND status IN ('REVOKED','EXPIRED');
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['artifact_manifests','artifact_dependencies','artifact_status_events','artifact_gc_runs','artifact_gc_candidates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true))', table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO agentics_app', table_name);
  END LOOP;
END $$;
REVOKE DELETE ON artifact_manifests,artifact_dependencies,artifact_status_events FROM agentics_app;
