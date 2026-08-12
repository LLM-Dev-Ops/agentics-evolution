CREATE FUNCTION artifact_digest_has_other_live_reference(target_digest text, caller_tenant text, caller_manifest text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.artifact_digest_references
  WHERE artifact_digest=target_digest AND live AND (tenant_id<>caller_tenant OR manifest_digest<>caller_manifest)
) $$;
REVOKE ALL ON FUNCTION artifact_digest_has_other_live_reference(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact_digest_has_other_live_reference(text,text,text) TO agentics_app;
