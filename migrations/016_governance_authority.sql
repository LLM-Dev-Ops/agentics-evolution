CREATE TABLE governance_authorizations (
 tenant_id text NOT NULL, repository_id text NOT NULL, authorization_id uuid NOT NULL, requester text NOT NULL, approver text,
 candidate_digest text NOT NULL CHECK(candidate_digest~'^[a-f0-9]{64}$'), evidence_digest text NOT NULL CHECK(evidence_digest~'^[a-f0-9]{64}$'),
 environment text NOT NULL, expected_champion_version bigint NOT NULL, policy_epoch text NOT NULL, requested_envelope jsonb NOT NULL,
 approved_envelope jsonb, state text NOT NULL CHECK(state IN('REQUESTED','APPROVED','CONSUMED','DENIED','EXPIRED','REVOKED')),
 expires_at timestamptz NOT NULL, max_uses integer NOT NULL CHECK(max_uses>0), uses integer NOT NULL DEFAULT 0 CHECK(uses>=0 AND uses<=max_uses), version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(tenant_id,authorization_id), CHECK(approver IS NULL OR approver<>requester)
);
CREATE TABLE governance_authorization_events(tenant_id text NOT NULL,authorization_id uuid NOT NULL,event_version bigint NOT NULL,event_type text NOT NULL,
 actor text NOT NULL,event_id uuid NOT NULL,payload jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(tenant_id,authorization_id,event_version));
CREATE TABLE governance_idempotency(tenant_id text NOT NULL,idempotency_key uuid NOT NULL,request_digest text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(tenant_id,idempotency_key));
CREATE TABLE governance_delegations(tenant_id text NOT NULL,delegation_id uuid NOT NULL,parent_id uuid,envelope jsonb NOT NULL,state text NOT NULL,version bigint NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,delegation_id));
CREATE TABLE tenant_security_profiles(tenant_id text NOT NULL,version bigint NOT NULL,profile jsonb NOT NULL,active boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant_id,version));
CREATE TABLE tenant_tombstones(tenant_id text NOT NULL,repository_id text NOT NULL,tombstone_id uuid NOT NULL,state text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(tenant_id,repository_id));
CREATE TABLE deletion_results(tenant_id text NOT NULL,tombstone_id uuid NOT NULL,adapter text NOT NULL,status text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(tenant_id,tombstone_id,adapter));
CREATE TABLE governance_decisions(tenant_id text NOT NULL,decision_id uuid NOT NULL,action text NOT NULL,outcome text NOT NULL,decision_digest text NOT NULL,policy_epoch text NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(tenant_id,decision_id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['governance_authorizations','governance_authorization_events','governance_idempotency','governance_delegations','tenant_security_profiles','tenant_tombstones','deletion_results','governance_decisions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true))',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO agentics_app',t); END LOOP; END $$;
REVOKE UPDATE,DELETE ON governance_authorization_events,governance_decisions,deletion_results FROM agentics_app;
