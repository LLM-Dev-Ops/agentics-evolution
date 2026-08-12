# ADR-022: Observability, SLOs, and incident response

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: telemetry, slo, alerts, incidents

## Context

An evolving system can be functionally wrong while infrastructure remains healthy. Operations need business, safety, evidence, cost, and statistical signals.

## Decision

Instrument all roles with OpenTelemetry and publish normalized metrics to observatory. Use structured logs with tenant-safe identifiers and content digests, never raw prompts/source.

Mandatory telemetry includes cycle lag/completion, hypothesis novelty, candidate admission/rejection, sandbox violations, evaluator pass/regression, sequential alpha/power, receipt verification, authorization decisions, rollout stage/drift/rollback, provider cost/latency/error, queue age/dead letters, lease fencing, outbox lag, CAS integrity, and cross-tenant denials.

SLOs from ADR-008 become monitored objectives with burn-rate alerts. Security, unauthorized promotion, cross-tenant disclosure, receipt-integrity failure, and key misuse page immediately outside the availability error budget.

Every alert names owner, severity, customer impact, evidence links, and runbook. Incident-manager receives signed incident facts. Post-incident corrections enter Observation as human-verified evidence but cannot bypass Dream/Forge/Flywheel gates.

Trace sampling retains all errors, promotions, policy denies, security events, and integrity failures; normal high-volume traces use tail sampling.

## Acceptance criteria

1. Synthetic signals trigger every page/ticket and link a tested runbook.
2. End-to-end trace connects API command, event, worker, model, evaluation, policy, and rollout.
3. Cardinality and secret/PII log tests pass.
4. SLO calculations agree with replayed fixture data.
5. Telemetry outage does not permit promotion; critical audit events buffer durably.

## Links

- [ADR-008](ADR-008-production-runtime-and-operations.md)
- Agentics observatory and incident-manager
