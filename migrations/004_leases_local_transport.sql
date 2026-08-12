BEGIN;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS outbox_expired_lease_idx ON outbox(lease_expires_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS local_transport_messages (
  tenant_id text NOT NULL,
  message_id uuid NOT NULL,
  event_id uuid NOT NULL,
  topic text NOT NULL,
  ordering_key text NOT NULL,
  envelope jsonb NOT NULL,
  attributes jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  delivery_count integer NOT NULL DEFAULT 0,
  acked_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,message_id),
  UNIQUE (tenant_id,event_id,topic),
  CHECK (octet_length(envelope::text) <= 262144)
);
CREATE INDEX IF NOT EXISTS local_transport_pending_idx ON local_transport_messages(tenant_id,topic,available_at,created_at) WHERE acked_at IS NULL;
ALTER TABLE local_transport_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_transport_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON local_transport_messages USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON local_transport_messages TO agentics_app;
COMMIT;
