# Agentics Evolution production plan

This directory is the implementation authority for the Agentics Evolution control plane described in [`../../research.md`](../../research.md). The records use the Ruflo ADR lifecycle and DDD bounded-context conventions.

## Outcome

Implementation of every accepted record must produce an operable multi-repository system, not a scaffold: scheduled observation and research, bounded Darwin mutation, replayable Flywheel evaluation, policy-gated promotion, durable provenance, telemetry, recovery, and verified deployment.

## Foundation decisions

1. [ADR-001](adrs/ADR-001-adopt-ruvnet-evolution-kernel.md) — adopt and pin the Ruvnet kernel.
2. [ADR-002](adrs/ADR-002-trust-state-and-artifact-protocol.md) — define trust states and artifact protocol.
3. [ADR-003](adrs/ADR-003-dream-cycle-observation-and-research.md) — ingest evidence and form hypotheses.
4. [ADR-004](adrs/ADR-004-darwin-bounded-mutation.md) — create bounded candidates.
5. [ADR-005](adrs/ADR-005-flywheel-evaluation-and-promotion.md) — evaluate and promote with proof.
6. [ADR-006](adrs/ADR-006-policy-security-and-tenancy.md) — enforce authority and isolation.
7. [ADR-007](adrs/ADR-007-storage-provenance-and-recovery.md) — make state durable and recoverable.
8. [ADR-008](adrs/ADR-008-production-runtime-and-operations.md) — deploy and operate the service.

## Implementation decisions

9. [ADR-009](adrs/ADR-009-upstream-conformance-and-anti-drift.md) — make Ruvnet ownership machine-enforced.
10. [ADR-010](adrs/ADR-010-public-api-and-service-identity.md) — define API and workload identity.
11. [ADR-011](adrs/ADR-011-event-transport-and-delivery-semantics.md) — select event delivery semantics.
12. [ADR-012](adrs/ADR-012-scheduling-leases-and-work-cancellation.md) — fence schedules and cancellation.
13. [ADR-013](adrs/ADR-013-transactional-persistence-and-migrations.md) — select transactional storage.
14. [ADR-014](adrs/ADR-014-content-addressed-artifact-lifecycle.md) — govern immutable artifacts.
15. [ADR-015](adrs/ADR-015-github-repository-integration.md) — constrain GitHub integration.
16. [ADR-016](adrs/ADR-016-candidate-sandbox-and-network-isolation.md) — isolate untrusted execution.
17. [ADR-017](adrs/ADR-017-model-routing-and-provider-execution.md) — reuse Ruflo/MetaHarness routing.
18. [ADR-018](adrs/ADR-018-evaluation-corpus-and-contamination-control.md) — protect evaluation truth.
19. [ADR-019](adrs/ADR-019-signing-keys-and-receipt-verification.md) — operate signing and verification.
20. [ADR-020](adrs/ADR-020-multi-tenant-privacy-and-retention.md) — enforce privacy and retention.
21. [ADR-021](adrs/ADR-021-gcp-production-topology-and-environments.md) — select the GCP topology.
22. [ADR-022](adrs/ADR-022-observability-slos-and-incident-response.md) — operate measurable SLOs.
23. [ADR-023](adrs/ADR-023-supply-chain-release-and-upstream-upgrades.md) — secure releases and upgrades.
24. [ADR-024](adrs/ADR-024-business-continuity-and-disaster-recovery.md) — recover the complete system.
25. [ADR-025](adrs/ADR-025-ruvector-brain-intelligence-substrate.md) — use private RuVector Brain plus governed π federation.

## Domain designs

- [Context map](ddd/DDD-001-context-map-and-ubiquitous-language.md)
- [Observation context](ddd/DDD-002-observation-context.md)
- [Dream context](ddd/DDD-003-dream-context.md)
- [Evolution context](ddd/DDD-004-evolution-context.md)
- [Evaluation context](ddd/DDD-005-evaluation-context.md)
- [Governance context](ddd/DDD-006-governance-context.md)
- [Operations context](ddd/DDD-007-operations-context.md)
- [Upstream ACLs](ddd/DDD-008-upstream-anti-corruption-layers.md)
- [Repository Integration context](ddd/DDD-009-repository-integration-context.md)
- [Artifact Lineage context](ddd/DDD-010-artifact-lineage-context.md)
- [Evaluation Corpus context](ddd/DDD-011-evaluation-corpus-context.md)
- [Brain Knowledge context](ddd/DDD-012-brain-knowledge-context.md)

## Delivery authority

[The production delivery plan](implementation-plan.md) defines vertical slices, dependency order, acceptance evidence, rollback gates, and the definition of done. An ADR is not implemented until its linked executable evidence passes in CI and a clean production-like environment.

[The ordered implementation prompts](implementation-prompts.md) translate that dependency graph into 21 executable, gated implementation sessions. They are instructions for future implementation and do not indicate that any implementation has begun.

## Upstream baseline

Versions inspected on 2026-08-11:

| Component | Baseline | Role |
|---|---:|---|
| `ruflo` | 3.37.0 | orchestration, workers, hooks, AgentDB bridges |
| `metaharness` | 0.4.5 | repo analysis and harness generation |
| `@metaharness/darwin` | 0.9.1 | bounded mutation and evolutionary search |
| `@metaharness/flywheel` | 0.1.10 | promotion loop, lineage, receipts, replay |
| `@metaharness/redblue` | 0.1.4 | adversarial evaluation |
| `@metaharness/turn-credit` | 0.1.0 | trajectory credit evidence |
| `@metaharness/router` | 0.4.0 | cost-aware routing |
| `@metaharness/harness` | 0.2.0 | harness lifecycle |
| `ruvector` | 0.2.41 | private Brain client/MCP, RVF, SONA, graph intelligence |

Exact versions and integrity hashes must be committed to the lockfile. Renovation occurs through compatibility CI and an explicit dependency PR; production must never execute floating `latest` packages.
