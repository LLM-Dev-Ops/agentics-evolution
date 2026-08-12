ALTER TABLE outbox ADD COLUMN IF NOT EXISTS first_attempt_at timestamptz;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
ALTER TABLE dead_letters ADD COLUMN IF NOT EXISTS source_topic text;
ALTER TABLE dead_letters ADD COLUMN IF NOT EXISTS repository_id text;
ALTER TABLE dead_letters ADD COLUMN IF NOT EXISTS aggregate_id text;
ALTER TABLE dead_letters ADD COLUMN IF NOT EXISTS redrive_count integer NOT NULL DEFAULT 0 CHECK (redrive_count >= 0);
