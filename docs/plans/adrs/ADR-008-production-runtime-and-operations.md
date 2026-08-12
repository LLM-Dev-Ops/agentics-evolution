# ADR-008: Production runtime and operations

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: runtime, deployment, sre, observability

## Context

A production-ready evolution loop needs durable scheduling, isolated workers, safe rollouts, actionable telemetry, and runbooks. A local daemon or cron-only script is insufficient.

## Decision

Deploy three independently scalable roles from one versioned codebase:

1. **API/control service**: enrollment, status, approvals, verification, and read APIs.
2. **Scheduler/orchestrator**: acquires repository leases, creates cycles, and publishes work.
3. **Ephemeral workers**: observation, research, mutation, evaluation, replay, and rollout checks.

Use managed PostgreSQL, durable queue, versioned object storage, managed KMS, and OpenTelemetry. Runtime deployment may use the existing Agentics cloud convention, but manifests must support local production-parity via containers.

### Reliability

- API and scheduler are multi-instance; leases use fencing tokens, not PIDs.
- Work items carry deadlines, attempt limits, idempotency keys, and cancellation tokens.
- Graceful shutdown stops intake, renews or releases leases safely, and checkpoints resumable Darwin archives.
- Backpressure is based on queue age, tenant concurrency, usage budget, and provider health.
- Circuit breakers isolate model, GitHub, research, memory, and evaluation providers.

### SLOs

- Read/control API: 99.9% monthly availability, p95 under 500 ms excluding artifact downloads.
- Scheduled cycles: 99% start within 15 minutes of schedule when dependencies are healthy.
- Committed receipt verification: 99.99% success; any integrity failure is a page.
- No unauthorized promotions and no cross-tenant disclosure are error-budget-exempt incidents.

### Delivery

- CI runs type/lint/unit, contract, integration, deterministic replay, security, RedBlue, load, chaos, migration, SBOM, and image-signature gates.
- Environments are dev, staging, and production with distinct identities and keys.
- Database migrations are backward-compatible, expand/migrate/contract, and rollback-tested.
- Release proceeds staging → internal canary → production canary → full, with automated rollback.

### Operations

Runbooks cover stuck cycles, queue backlog, provider outage, exhausted alpha epoch, budget exhaustion, receipt mismatch, key rotation, corrupted artifact, failed migration, and emergency rollback.

## Acceptance criteria

1. A production-like end-to-end run completes from enrollment to authorized canary and verified rollback.
2. Load tests meet SLO at declared capacity with bounded resource use.
3. Killing every role at each transaction boundary loses no committed state and causes no duplicate promotion.
4. Chaos tests validate provider circuit breakers and degraded read-only mode.
5. On-call dashboards and alerts link to tested runbooks.
6. A clean environment verifies image, SBOM, source receipt, migrations, and Flywheel replay before serving.

## Links

- [Implementation plan](../implementation-plan.md)
- [DDD-007](../ddd/DDD-007-operations-context.md)
- Ruflo worker daemon semantics are reused inside workers, not as the durable scheduler of record.
