ALTER TABLE artifact_gc_candidates ADD COLUMN intent_id uuid;
ALTER TABLE artifact_gc_candidates ADD COLUMN intent_fence bigint NOT NULL DEFAULT 0 CHECK (intent_fence >= 0);
ALTER TABLE artifact_gc_candidates ADD COLUMN intent_expires_at timestamptz;
ALTER TABLE artifact_gc_candidates ADD COLUMN deleted_at timestamptz;
CREATE UNIQUE INDEX artifact_gc_delete_intent_unique ON artifact_gc_candidates(tenant_id,intent_id) WHERE intent_id IS NOT NULL;

CREATE TABLE artifact_legal_hold_nonces (
  tenant_id text NOT NULL,
  nonce text NOT NULL,
  manifest_digest text NOT NULL,
  action text NOT NULL CHECK (action IN ('PLACE','RELEASE')),
  consumed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,nonce)
);
ALTER TABLE artifact_legal_hold_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_legal_hold_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON artifact_legal_hold_nonces USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT ON artifact_legal_hold_nonces TO agentics_app;
