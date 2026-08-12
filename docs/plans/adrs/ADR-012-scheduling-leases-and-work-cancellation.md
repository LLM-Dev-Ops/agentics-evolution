# ADR-012: Scheduling, leases, and work cancellation

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: scheduler, leases, fencing, cancellation

## Context

Nightly work must survive restarts without overlapping repository writers or relying on process-local timers.

## Decision

Cloud Scheduler triggers a private scheduler endpoint; PostgreSQL is the schedule and lease authority. Ruflo worker dispatch executes cycle steps after a durable work item exists.

- Schedule windows are computed in the enrollment timezone and stored in UTC with tzdb version.
- Uniqueness on `(repositoryId,scheduleKind,windowStart)` prevents duplicate cycles.
- Repository leases use monotonically increasing fencing tokens. Every workspace write, checkpoint, and champion mutation presents the current token.
- Leases renew at one-third TTL. Expired workers may finish compute but cannot commit results.
- One bounded catch-up window is allowed; older missed windows are recorded as skipped.
- Cancellation is persistent and cooperative: queue consumers, Ruflo tasks, model calls, containers, and evaluators receive a cancellation token and deadline.
- Provider/budget/backpressure checks may defer start without consuming a cycle attempt.

Ruflo's daemon is reused inside workers for hooks and learning, but is not the durable organization scheduler.

## Acceptance criteria

1. Concurrent scheduler instances create one cycle per window.
2. Stale fencing tokens cannot commit after lease transfer.
3. DST, leap-day, clock-skew, delayed trigger, and catch-up tests pass.
4. Cancellation stops queued and active descendants within the declared bound.
5. Scheduler restart loses no due work and creates no overlap.

## Links

- [DDD-007](../ddd/DDD-007-operations-context.md)
- Ruflo workers/hooks and Agentics orchestration-engine
