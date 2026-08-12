# ADR-009: Upstream conformance and anti-drift authority

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: conformance, anti-drift, upstream, ownership

## Context

The largest delivery risk is silently recreating or weakening Ruvnet mechanisms while implementing Agentics adapters. Documentation alone cannot prevent that drift.

## Decision

Establish a machine-enforced upstream authority catalog. Each capability has one authoritative implementation and one permitted Agentics adapter. Domain code may depend only on the adapter port.

| Capability | Authority | Adapter obligation |
|---|---|---|
| Harness analysis | `metaharness` | preserve report schema and evidence |
| Mutation/search/safety inspection | `@metaharness/darwin` | configure, never reimplement |
| Gate, receipts, lineage, replay | `@metaharness/flywheel` | persist and authorize only |
| Adversarial evaluation | `@metaharness/redblue` | supply suites and normalize findings |
| Turn attribution | `@metaharness/turn-credit` | bind evidence to receipts |
| Model selection | Ruflo router + `@metaharness/router` | provide price/quality observations |
| Agent coordination | Ruflo swarms/hooks/workers | durable scheduling remains Agentics-owned |
| Cognitive memory/graph/transfer | RuVector Brain, RVF, SONA | private Brain ACL and governed π federation |
| Policy envelope | Ruflo capability algebra + Agentics policy-engine | make decisions before effects |

The repository must contain `config/upstream-authorities.yaml` with package, exact version, integrity, exported symbols used, upstream ADRs, adapter owner, contract tests, and approved deviations. A CI scanner rejects duplicate local implementations by forbidden symbol/algorithm patterns and dependency-boundary rules.

Upgrades require a compatibility branch, upstream test suite, Agentics contract suite, replay of the golden corpus, receipt compatibility proof, performance comparison, and signed approval. A breaking upstream change blocks release; it never activates through a floating dependency.

## Acceptance criteria

1. CI fails on floating versions, unrecorded exports, or direct domain imports.
2. Mutation, sequential-evidence, canonicalization, signing, and gate algorithms have no Agentics duplicates.
3. Golden replay bundles and real Brain protocol fixtures verify before and after compatible upgrades.
4. Every deviation has an expiry, owner, threat analysis, and accepted ADR.
5. A generated conformance report is attached to every release.

## Links

- [ADR-001](ADR-001-adopt-ruvnet-evolution-kernel.md)
- [DDD-008](../ddd/DDD-008-upstream-anti-corruption-layers.md)
