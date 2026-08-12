# ADR-001: Adopt the Ruvnet evolution kernel

- **Status**: proposed
- **Date**: 2026-08-11
- **Deciders**: Agentics maintainers
- **Tags**: metaharness, ruflo, darwin, flywheel, reuse

## Context

Agentics needs an organization-wide learning control plane. Ruvnet already ships the hard mechanisms: MetaHarness analysis and host adapters, Darwin bounded mutation, Flywheel evaluation/lineage/receipts, Ruflo orchestration and learning hooks, AgentDB/RuVector memory, RedBlue adversarial tests, and turn-credit evidence. Rebuilding these would introduce incompatible semantics and weaker evidence.

## Decision

Use upstream packages as the kernel and implement only Agentics-specific application services and anti-corruption layers.

### Ownership

| Capability | Authority | Agentics responsibility |
|---|---|---|
| Harness analysis/generation | `metaharness`, `@metaharness/harness` | configuration and repository adapters |
| Candidate search | `@metaharness/darwin` | mutation-surface policy and evaluator wiring |
| Promotion/lineage/replay | `@metaharness/flywheel` | durable store and authorization adapter |
| Adversarial evaluation | `@metaharness/redblue` | threat suites and result normalization |
| Orchestration/trajectories | `ruflo` | scheduled workflows and tenant scoping |
| Semantic/cognitive intelligence | RuVector Brain (`mcp-brain-server`, RVF, SONA) | private Brain ACL, tenant policy, governed π federation |
| Organizational policy | Agentics policy-engine/enforcement | map decisions to Ruflo action capabilities |
| Usage accounting | agentics-usage-ledger | cost reservation and reconciliation |

### Dependency rules

- Pin exact versions and lockfile integrity hashes; Node.js 20 is the minimum runtime.
- Wrap each upstream boundary behind a typed port. Domain code cannot import an upstream package.
- Validate runtime compatibility at boot and fail readiness when a required production capability is absent.
- Keep a compatibility matrix for Linux x64/arm64 and supported Codex/Claude Code hosts.
- Use upstream receipt and canonicalization formats unchanged. Extensions belong in versioned Agentics envelopes.
- Do not fork upstream code initially. Patch upstream or isolate a temporary adapter with an expiry date.

### Existing Agentics reuse

- `agentics-org-manifests`: repository enrollment source.
- `agentics-orchestration-engine` and `agentics-execution-engine`: workflow dispatch and isolated execution.
- `test-bench`: project anchor and holdout execution.
- `policy-engine` plus `agentics-enforcement`: authorization and static checks.
- `agentics-usage-ledger`: budget authority.
- `memory-graph`/`ruvector-service`: integrate with the private RuVector Brain rather than implement a second graph/vector engine.
- `observatory`: telemetry sink.
- `research-core`: source acquisition adapter, not truth authority.
- `forge`: signed build and artifact packaging integration.

## Consequences

### Positive

- Production mechanisms begin from tested upstream implementations.
- Upstream replay and receipt tooling remains independently usable.
- Agentics concentrates on multi-repository governance and operations.

### Negative

- Several pre-1.0 packages require strict version control and compatibility tests.
- Adapter maintenance follows upstream API changes.

### Neutral

- Ruflo's upstream rule that MetaHarness remain removable from core Ruflo does not make it optional for this service; Agentics Evolution is explicitly a MetaHarness application.

## Acceptance criteria

1. A dependency conformance test rejects ranges, git URLs, and unverified tarballs.
2. Contract tests run against every pinned package, both supported hosts, and a real local RuVector Brain service.
3. Removing any adapter produces a deterministic readiness failure, never silent degradation.
4. A license/SBOM/provenance job covers all transitive production dependencies.
5. No local source implements mutation search, receipt signing, lineage replay, or sequential promotion math.

## Links

- Ruflo ADR-150, ADR-153, ADR-322, ADR-322B, ADR-322C, ADR-331, ADR-381
- MetaHarness `packages/darwin-mode` and `packages/flywheel`
- [DDD-001](../ddd/DDD-001-context-map-and-ubiquitous-language.md)
