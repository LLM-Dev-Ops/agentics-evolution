# ADR-007: Storage, provenance, and recovery

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: persistence, provenance, recovery, ruvector

## Context

Evaluation lineage, evidence, and authorization must survive process loss and remain independently verifiable. Vector memory is valuable for retrieval but is not a transactional source of truth.

## Decision

Use separate stores by consistency requirement:

| Data | System of record | Use |
|---|---|---|
| aggregates, idempotency, champion pointers, outbox | PostgreSQL | serializable transactions |
| source snapshots, candidate bundles, reports, receipts | versioned object storage/CAS | immutable evidence |
| semantic observations, hypotheses, graph, drift and transfer priors | private RuVector Brain via Brain ACL | retrieval and cognitive projection |
| cost reservations and actuals | agentics-usage-ledger | financial authority |
| metrics/traces/logs | observatory/OpenTelemetry backend | operations |

Brain memories/RVF entries store typed provenance and the CAS digest; they never replace the canonical artifact. Retrieval-time filters enforce tenant, namespace, trust state, source, quality, expiry, and supersession.

### Integrity

- Canonical JSON and SHA-256 identify every artifact; Flywheel receipts retain upstream Ed25519 semantics.
- A signed cycle manifest binds input snapshot, config, model, artifacts, and outputs.
- Database rows reference immutable artifact digests. Missing or mismatched objects make the aggregate unavailable for promotion.
- Outbox/inbox tables provide at-least-once delivery with idempotent consumers.

### Recovery

- PostgreSQL has point-in-time recovery, encrypted backups, and quarterly restore drills.
- Object storage has retention lock, versioning, lifecycle rules, and cross-region replication.
- Queue redrive and reconciliation jobs rebuild projections from canonical events.
- RPO target: 5 minutes for transactional state; zero loss for committed immutable evidence. RTO target: 60 minutes.

## Acceptance criteria

1. Restore drills reconstruct champion and lineage and replay a sampled receipt.
2. Deleting the private Brain projection does not lose canonical evidence; Brain/RVF projection rebuild is deterministic.
3. Missing/corrupt objects block promotion and page operations.
4. Event replay and database state agree at a signed checkpoint.
5. Tenant deletion follows retention policy without breaking required audit chains; tombstones preserve non-sensitive integrity facts.
6. Backup credentials and signing keys use distinct roles.

## Links

- [DDD-007](../ddd/DDD-007-operations-context.md)
- Ruflo ADR-322C and ADR-323 typed memory provenance
- AgentDB/RuVector and Agentics usage-ledger
