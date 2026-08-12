# ADR-013: Transactional persistence and migrations

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: postgres, schema, transactions, migrations

## Context

Champion selection, alpha spend, approval consumption, budgets, idempotency, and outbox delivery require transactional consistency.

## Decision

Use regional high-availability Cloud SQL for PostgreSQL 16 as the transactional system of record.

- Every table contains tenant identity; repository-scoped unique keys include it.
- Row-level security is defense in depth; application queries must also bind tenant explicitly.
- Aggregate updates use version columns. Promotion, sequential-evidence allocation, approval consumption, and budget reservation use serializable transactions with bounded retry.
- Store append-only domain events plus current aggregate projections; events are audit/rebuild inputs, not an excuse for eventual consistency in critical commands.
- Timestamps are UTC database time; UUIDv7 identifiers are application-generated and validated.
- Migrations use expand → dual-read/write when necessary → backfill → verify → contract. Destructive migrations require backup checkpoint and separate authorization.
- Schema migrations run once through a release job; application pods never auto-migrate at boot.

Connection pools are bounded per role and fronted by the Cloud SQL connector. Queries have statement/lock timeouts and slow-query telemetry.

## Acceptance criteria

1. Database constraints encode aggregate uniqueness and tenant boundaries.
2. Concurrent promotion/alpha/budget/approval tests serialize correctly.
3. Every migration upgrades a production-size fixture, rolls forward after interruption, and supports mixed-version deployment.
4. PITR restore and projection rebuild meet ADR-007 objectives.
5. Query plans for critical paths meet declared latency at capacity.

## Links

- [ADR-007](ADR-007-storage-provenance-and-recovery.md)
- [ADR-011](ADR-011-event-transport-and-delivery-semantics.md)
