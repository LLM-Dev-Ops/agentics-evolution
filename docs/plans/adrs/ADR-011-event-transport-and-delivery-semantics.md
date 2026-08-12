# ADR-011: Event transport and delivery semantics

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: events, pubsub, outbox, retries

## Context

Contexts and workers require durable asynchronous delivery. Exactly-once execution cannot be assumed across databases, queues, model calls, and GitHub.

## Decision

Use Google Cloud Pub/Sub for transport and PostgreSQL transactional outbox/inbox for correctness.

- Topic families: `evolution.commands.v1`, `evolution.events.v1`, and `evolution.deadletter.v1`.
- Ordering key is `tenantId/repositoryId/aggregateId`; consumers remain correct if ordering is lost.
- Delivery is at least once. Inbox uniqueness on `(consumer,eventId)` makes state transitions idempotent.
- Publisher writes domain state and outbox row in one transaction. A relay publishes with trace context and marks delivery after broker acknowledgement.
- Exponential backoff with jitter, bounded attempts, maximum event age, and dead-letter reason are configured per message class.
- Payloads contain envelopes and CAS references, not source archives or secrets. Maximum serialized size is 256 KiB.
- Schema compatibility is backward for events and backward+forward during rolling deploys. Unknown critical event versions dead-letter.

Replay uses a separate subscription and never republishes side effects without an explicit replay capability and dry-run default.

## Acceptance criteria

1. Duplicate, delayed, reordered, and poison-message tests preserve aggregate invariants.
2. Database commit plus process death eventually publishes exactly one logical event.
3. Broker success plus acknowledgement loss causes harmless redelivery.
4. Dead letters are visible, attributable, redrivable, and covered by a runbook.
5. Trace/correlation/causation IDs survive every hop.

## Links

- [ADR-002](ADR-002-trust-state-and-artifact-protocol.md)
- [ADR-013](ADR-013-transactional-persistence-and-migrations.md)
