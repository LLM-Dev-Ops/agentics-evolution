CREATE TABLE artifact_digest_references (
  tenant_id text NOT NULL,
  repository_id text NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[a-f0-9]{64}$'),
  manifest_digest text NOT NULL,
  live boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  released_at timestamptz,
  PRIMARY KEY (tenant_id,repository_id,artifact_digest,manifest_digest),
  FOREIGN KEY (tenant_id,manifest_digest) REFERENCES artifact_manifests ON DELETE RESTRICT
);
CREATE INDEX artifact_digest_live_refs ON artifact_digest_references(artifact_digest) WHERE live;
ALTER TABLE artifact_digest_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_digest_references FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON artifact_digest_references USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE ON artifact_digest_references TO agentics_app;

INSERT INTO artifact_digest_references(tenant_id,repository_id,artifact_digest,manifest_digest)
SELECT tenant_id,repository_id,artifact_digest,manifest_digest FROM artifact_manifests ON CONFLICT DO NOTHING;

CREATE FUNCTION artifact_digest_has_other_live_reference(target_digest text, caller_tenant text, caller_manifest text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.artifact_digest_references
  WHERE artifact_digest=target_digest AND live AND (tenant_id<>caller_tenant OR manifest_digest<>caller_manifest)
) $$;
REVOKE ALL ON FUNCTION artifact_digest_has_other_live_reference(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact_digest_has_other_live_reference(text,text,text) TO agentics_app;
