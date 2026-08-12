ALTER TABLE local_transport_messages DROP CONSTRAINT local_transport_topic_family;
ALTER TABLE local_transport_messages ADD CONSTRAINT local_transport_topic_family CHECK (topic IN ('evolution.commands.v1','evolution.events.v1','evolution.deadletter.v1','evolution.replay.v1'));
