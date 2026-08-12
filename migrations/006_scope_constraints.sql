ALTER TABLE aggregates ADD CONSTRAINT aggregates_one_repository_per_id UNIQUE (tenant_id, aggregate_id);
ALTER TABLE outbox ADD CONSTRAINT outbox_ordering_scope CHECK (ordering_key = tenant_id || '/' || repository_id || '/' || aggregate_id);
ALTER TABLE local_transport_messages ADD CONSTRAINT local_transport_topic_family CHECK (topic IN ('evolution.commands.v1','evolution.events.v1','evolution.deadletter.v1'));
