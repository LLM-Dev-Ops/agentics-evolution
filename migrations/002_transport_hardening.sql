ALTER TABLE outbox ADD COLUMN IF NOT EXISTS message_class text NOT NULL DEFAULT 'event';
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (transaction_timestamp() + interval '7 days');
ALTER TABLE inbox ADD COLUMN IF NOT EXISTS replay_id uuid;
CREATE INDEX IF NOT EXISTS inbox_replay_idx ON inbox(tenant_id, replay_id) WHERE replay_id IS NOT NULL;
