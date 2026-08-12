CREATE TABLE consumer_progress (
  tenant_id text NOT NULL,
  consumer text NOT NULL,
  repository_id text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 0 CHECK (aggregate_version >= 0),
  last_event_id uuid,
  last_payload_digest text CHECK (last_payload_digest IS NULL OR last_payload_digest ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,consumer,repository_id,aggregate_id)
);
ALTER TABLE consumer_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consumer_progress USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON consumer_progress TO agentics_app;
