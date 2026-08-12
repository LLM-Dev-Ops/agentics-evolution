# DDD-003: Dream context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Turn sealed evidence into novel, sourced, falsifiable hypotheses without changing code or trusted memory.

## Aggregate: `DreamCycle`

### State

`SCHEDULED → COLLECTING → CLUSTERING → REASONING → PUBLISHED`, with terminal `INCOMPLETE|CANCELLED`.

### Invariants

- One active cycle per repository and schedule window, enforced with a fencing token.
- Input batches and repository snapshot are fixed before clustering.
- Budget is reserved before model/tool execution.
- A publishable hypothesis has sources, novelty result, target metric, mutation surface, verifier, cost estimate, and confidence.
- Incomplete cycles enqueue no mutation work.
- Dream has no repository-write or promotion capability.

## Entities and value objects

- `SurfaceRotation`: deep/scan surfaces, cadence, exhaustion rules.
- `FailureCluster`: embedding centroid, members, chosen exemplar, held-out flag.
- `Hypothesis`: claim, rationale, evidence, falsifier, affected contexts, proposed surface.
- `CycleWitness`: config, snapshot, inputs, outputs, hashes, runtime identity.

## Commands

- `ScheduleDreamCycle`
- `StartDreamCycle`
- `AttachEvidenceBatch`
- `FormFailureClusters`
- `ProposeHypothesis`
- `RejectDuplicateHypothesis`
- `PublishDreamCycle`
- `CancelDreamCycle`

## Events

- `DreamCycleScheduled`, `DreamCycleStarted`, `FailureClustersFormed`
- `HypothesisProposed`, `HypothesisRejectedAsDuplicate`
- `DreamCyclePublished`, `DreamCycleIncomplete`, `DreamCycleCancelled`

## Domain services

- `RotationPolicy`: deterministic topic selection and drift checks.
- `ClusterSelector`: RuVector clustering with one exemplar per failure class.
- `ResearchSynthesizer`: treats retrieved content as quoted data and emits claim/source pairs.
- `NoveltyJudge`: compares prior hypotheses, ADRs, rejected lineage, and active work.
- `HypothesisValidator`: validates falsifiability and maps to an approved mutation surface.

## Ruflo integration

Ruflo owns worker coordination, trajectory retrieval, memory search, hooks, model routing, and NightlyLearner integration. The context owns cycle state and uses an ACL so Ruflo worker results cannot directly change aggregate state without validation.

## Tests

- Rotation/cadence/drift golden tests.
- Stable clustering with fixed embeddings and seed.
- Research injection and citation-integrity tests.
- Duplicate, contradiction, budget, cancellation, and missed-schedule tests.
- Capability test proving no Dream identity can write a repository.
