# DDD-007: Operations context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Enroll repositories, schedule and fence work, roll out authorized champions, observe production behavior, and recover safely.

## Aggregate: `RepositoryEnrollment`

### State

`DRAFT → VALIDATED → ACTIVE`, with `PAUSED|QUARANTINED|RETIRED`.

### Invariants

- Manifest resolves to one immutable repository identity and default branch.
- Schedule, sources, surfaces, budgets, suites, environments, and owners validate before activation.
- Active enrollment has a project-local anchor and mutation contract.
- Paused/quarantined repositories start no new work.
- Manifest changes are versioned and policy-checked.

## Aggregate: `Rollout`

### State

`AUTHORIZED → SHADOW → CANARY → PRODUCTION`, with `ROLLED_BACK|FAILED|CANCELLED`.

### Invariants

- Rollout binds authorization, qualified evidence, candidate artifact, environment, and expected champion version.
- Each stage has minimum sample volume, maximum duration, health predicates, and rollback target.
- Champion update is compare-and-swap and emits an outbox event atomically.
- Rollback selects a previously verified champion and cannot erase failed history.

## Supporting concepts

- `RepositoryLease(repositoryId, fencingToken, owner, expiresAt)`
- `WorkItem(idempotencyKey, deadline, attempt, capabilityRef, budgetRef)`
- `HealthWindow(metrics, sampleCount, drift, violations)`
- `Incident(severity, evidence, runbook, containment)`

## Domain services

- `EnrollmentValidator`: ACL over agentics-org-manifests and contract registry.
- `CycleScheduler`: durable schedule plus fenced lease.
- `RolloutController`: shadow/canary gates, champion CAS, automatic rollback.
- `Reconciler`: repairs outbox, orphan work, stale leases, and projection drift.
- `IncidentCoordinator`: integrates observatory and incident-manager.

## Tests

- Manifest/schema/ownership/anchor validation.
- Lease expiry, fencing, duplicate schedule, and clock-skew tests.
- Stage advancement, insufficient sample, drift, rollback, and concurrent rollout tests.
- Queue redrive, outbox repair, backup restore, key rotation, and provider outage drills.
- SLO dashboards tested against synthetic failure signals.
