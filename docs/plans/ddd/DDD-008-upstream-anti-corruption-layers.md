# DDD-008: Upstream anti-corruption layers

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Protect Agentics domain language while preserving Ruvnet semantics exactly at integration boundaries.

## ACLs

| ACL | Upstream | Domain output |
|---|---|---|
| `HarnessAnalysisPort` | MetaHarness | repository genome/readiness evidence |
| `DarwinEvolutionPort` | Darwin | candidate/archive/checkpoint refs |
| `FlywheelProofPort` | Flywheel | scores, receipts, lineage, replay verdict |
| `BrainKnowledgePort` | RuVector Brain | memories, topology, drift, transfer, propositions |
| `RufloCoordinationPort` | Ruflo | trajectories, routes, worker results |
| `RedBluePort` | MetaHarness RedBlue | normalized adversarial regression |

## Invariants

- ACLs translate types, not algorithms or verdicts.
- Raw upstream objects never cross into another domain context.
- Every call records upstream version/capability digest and correlation ID.
- Unknown enum/schema/capability values fail closed for writes and are observable for reads.
- Fallbacks must be explicitly equivalent and contract-tested; reduced functionality is reported, never disguised.

## Contract tests

Each ACL runs upstream real-service or package fixtures, golden serialization, error mapping, timeout/cancellation, version negotiation, and backward-compatible receipt/replay tests. The anti-drift CI catalog in ADR-009 maps every exported method to these tests.
