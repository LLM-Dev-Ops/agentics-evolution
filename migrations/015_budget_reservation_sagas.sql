CREATE TABLE budget_reservation_sagas (
 tenant_id text NOT NULL, repository_id text NOT NULL, idempotency_key uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'), organization_id text NOT NULL,
 ledger_reservation_id text, estimated_amount text NOT NULL CHECK(estimated_amount ~ '^(0|[1-9][0-9]*)$'),
 actual_amount text CHECK(actual_amount IS NULL OR actual_amount ~ '^(0|[1-9][0-9]*)$'),
 status text NOT NULL CHECK(status IN ('REQUESTED','RESERVED','CONSUMED','CANCELLED')),
 response jsonb, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(tenant_id,repository_id,idempotency_key), UNIQUE(tenant_id,ledger_reservation_id)
);
ALTER TABLE budget_reservation_sagas ENABLE ROW LEVEL SECURITY; ALTER TABLE budget_reservation_sagas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_reservation_sagas USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON budget_reservation_sagas TO agentics_app; REVOKE DELETE ON budget_reservation_sagas FROM agentics_app;
