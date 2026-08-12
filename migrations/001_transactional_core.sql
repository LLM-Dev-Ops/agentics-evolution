CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS aggregates (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_type text NOT NULL,
  version bigint NOT NULL CHECK (version >= 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, repository_id, aggregate_id)
);

CREATE TABLE IF NOT EXISTS domain_events (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  aggregate_id text NOT NULL,
  event_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  event_type text NOT NULL,
  envelope jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, repository_id, aggregate_id, aggregate_version),
  FOREIGN KEY (tenant_id, repository_id, aggregate_id) REFERENCES aggregates DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS command_idempotency (
  tenant_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS outbox (
  tenant_id text NOT NULL,
  event_id uuid NOT NULL,
  repository_id text NOT NULL,
  aggregate_id text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('evolution.commands.v1','evolution.events.v1')),
  ordering_key text NOT NULL,
  envelope jsonb NOT NULL,
  traceparent text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  published_at timestamptz,
  broker_message_id text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, event_id),
  CHECK (octet_length(envelope::text) <= 262144)
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(next_attempt_at, created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS inbox (
  tenant_id text NOT NULL,
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, consumer, event_id)
);

CREATE TABLE IF NOT EXISTS dead_letters (
  tenant_id text NOT NULL,
  event_id uuid NOT NULL,
  consumer text NOT NULL,
  reason_code text NOT NULL,
  reason_detail text NOT NULL,
  attempts integer NOT NULL,
  first_seen_at timestamptz NOT NULL,
  dead_lettered_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  traceparent text,
  envelope jsonb NOT NULL,
  redriven_at timestamptz,
  PRIMARY KEY (tenant_id, consumer, event_id)
);

CREATE TABLE IF NOT EXISTS critical_resources (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('alpha','authorization','budget','champion')),
  resource_id text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  remaining numeric(30,0),
  consumed boolean NOT NULL DEFAULT false,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, repository_id, resource_type, resource_id)
);

ALTER TABLE aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE critical_resources ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['aggregates','domain_events','command_idempotency','outbox','inbox','dead_letters','critical_resources'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
