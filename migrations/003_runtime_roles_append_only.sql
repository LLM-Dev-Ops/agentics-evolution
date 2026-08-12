DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agentics_app') THEN CREATE ROLE agentics_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agentics_relay') THEN CREATE ROLE agentics_relay NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
GRANT SELECT,INSERT,UPDATE ON aggregates,command_idempotency,outbox,inbox,dead_letters,critical_resources TO agentics_app;
GRANT SELECT,INSERT ON domain_events TO agentics_app;
GRANT SELECT,UPDATE ON outbox TO agentics_relay;

CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'domain events are append-only' USING ERRCODE='55000'; END $$;
DROP TRIGGER IF EXISTS domain_events_append_only ON domain_events;
CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON domain_events FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
