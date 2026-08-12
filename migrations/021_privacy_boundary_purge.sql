CREATE OR REPLACE FUNCTION privacy_delete_database(p_tenant text,p_repository text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer:=0; c integer;
BEGIN
 IF p_tenant<>current_setting('app.tenant_id',true) THEN RAISE EXCEPTION 'tenant scope mismatch' USING ERRCODE='42501'; END IF;
 DELETE FROM critical_resources WHERE tenant_id=p_tenant AND repository_id=p_repository; GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM budget_reservation_sagas WHERE tenant_id=p_tenant AND repository_id=p_repository; GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM governance_authorization_events WHERE tenant_id=p_tenant AND authorization_id IN(SELECT authorization_id FROM governance_authorizations WHERE tenant_id=p_tenant AND repository_id=p_repository);GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM governance_authorizations WHERE tenant_id=p_tenant AND repository_id=p_repository;GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 RETURN n;
END $$;
CREATE OR REPLACE FUNCTION privacy_delete_events(p_tenant text,p_repository text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer:=0;c integer;
BEGIN
 IF p_tenant<>current_setting('app.tenant_id',true) THEN RAISE EXCEPTION 'tenant scope mismatch' USING ERRCODE='42501'; END IF;
 DELETE FROM inbox WHERE tenant_id=p_tenant AND event_id IN(SELECT event_id FROM domain_events WHERE tenant_id=p_tenant AND repository_id=p_repository);GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM local_transport_messages WHERE tenant_id=p_tenant AND envelope->>'repositoryId'=p_repository;GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM dead_letters WHERE tenant_id=p_tenant AND repository_id=p_repository;GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM outbox WHERE tenant_id=p_tenant AND repository_id=p_repository;GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 DELETE FROM consumer_progress WHERE tenant_id=p_tenant AND repository_id=p_repository;GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 -- Immutable domain-event digests remain as the integrity record; sensitive envelope material is purged.
 PERFORM set_config('agentics.privacy_purge','authorized',true);
 UPDATE domain_events SET envelope=jsonb_build_object('deleted',true,'eventId',event_id) WHERE tenant_id=p_tenant AND repository_id=p_repository;GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
 RETURN n;
END $$;
CREATE OR REPLACE FUNCTION privacy_release_artifact_refs(p_tenant text,p_repository text) RETURNS TABLE(removed integer,held integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_tenant<>current_setting('app.tenant_id',true) THEN RAISE EXCEPTION 'tenant scope mismatch' USING ERRCODE='42501'; END IF;
 UPDATE artifact_digest_references r SET live=false,released_at=transaction_timestamp() FROM artifact_manifests m
 WHERE r.tenant_id=p_tenant AND r.repository_id=p_repository AND r.tenant_id=m.tenant_id AND r.manifest_digest=m.manifest_digest AND NOT m.legal_hold;
 GET DIAGNOSTICS removed=ROW_COUNT;
 SELECT count(*)::integer INTO held FROM artifact_manifests WHERE tenant_id=p_tenant AND repository_id=p_repository AND legal_hold;
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION privacy_delete_database(text,text),privacy_delete_events(text,text),privacy_release_artifact_refs(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_delete_database(text,text),privacy_delete_events(text,text),privacy_release_artifact_refs(text,text) TO agentics_app;
CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND current_setting('agentics.privacy_purge',true)='authorized' AND NEW.event_id=OLD.event_id AND NEW.tenant_id=OLD.tenant_id THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'domain events are append-only' USING ERRCODE='55000';
END $$;
