# ADR-003: Dream Cycle observation and research

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: dream-cycle, observation, research, scheduling

## Context

The system needs both experiential learning from Agentics workloads and external learning from research. Inputs vary in trust, may contain prompt injection or secrets, and can repeat earlier findings.

## Decision

Implement Dream Cycle as a Ruflo-orchestrated, policy-gated application workflow, not a new agent framework.

### Cycle

1. Freeze a clean repository snapshot or content-addressed dirty snapshot.
2. Reserve cost and concurrency budget in agentics-usage-ledger.
3. Ingest enrolled sources through typed adapters.
4. Normalize, redact, scan, hash, and persist observations.
5. Use RuVector Brain search/partition/topology to deduplicate and cluster; select one exemplar per failure class.
6. Rotate configured deep and scan surfaces while honoring drift/exhaustion rules.
7. Generate sourced hypotheses with falsification tests and affected mutation surfaces.
8. Deduplicate against the private RuVector Brain and prior rejected/promoted lineage.
9. Publish the cycle report, witness digest, metrics, and candidate queue.

### Inputs

- Ruflo trajectories and verdicts, human corrections, CI/test failures, incidents, cost records, repository changes, ADR drift, and approved external research.
- External text—including public π Brain results—is untrusted data. It passes Brain admission, AIDefence, tool-output guards, and never contributes instructions to system prompts.
- Research claims require source URI, capture time, content hash, extracted claim, evidence grade, and an expiry/recheck policy.

### Scheduling

Use Ruflo worker dispatch from a single scheduler lease per tenant. The schedule is configurable in the repository enrollment manifest. Catch-up runs are bounded to one missed cycle; overlapping cycles for the same repository are forbidden.

### Outputs

Dream emits only `HypothesisProposed` records in `IMAGINED` state. A hypothesis contains expected metric, affected contexts, candidate mutation surface, verifier, estimated cost, confidence, and novelty evidence. It cannot write production memory or modify a repository.

## Failure behavior

- Missing source, stale snapshot, exhausted budget, scan failure, or unverifiable citation fails the affected hypothesis closed.
- Partial cycles publish an explicit incomplete report and do not enqueue candidates.
- Scheduler retries use exponential backoff with a dead-letter queue and operator-visible reason.

## Acceptance criteria

1. A deterministic fixture cycle reproduces identical clusters and report digests.
2. Prompt-injection fixtures never alter workflow instructions.
3. Duplicate findings across three cycles consolidate rather than create new hypotheses.
4. Secret/PII fixtures are quarantined and absent from reports and model prompts.
5. Lease and idempotency tests prove one cycle per repository/schedule window.
6. An unavailable research provider still permits an experience-only cycle marked degraded.
7. Every claim is traceable to immutable evidence.

## Links

- [DDD-002](../ddd/DDD-002-observation-context.md)
- [DDD-003](../ddd/DDD-003-dream-context.md)
- Ruflo NightlyLearner/ReasoningBank/hooks and RuVector Brain/RVF/SONA per ADR-025
