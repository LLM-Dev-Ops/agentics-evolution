DROP INDEX IF EXISTS outbox_pending_idx;
CREATE INDEX outbox_pending_idx ON outbox(tenant_id, next_attempt_at, created_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
