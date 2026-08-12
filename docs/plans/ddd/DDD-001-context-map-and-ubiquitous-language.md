# DDD-001: Context map and ubiquitous language

- **Status**: proposed
- **Date**: 2026-08-11

## Domain purpose

Agentics Evolution improves repository-specific agent harnesses through evidence, bounded mutation, independent evaluation, and separately authorized rollout.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Observation | Immutable, provenance-bearing fact from experience or research |
| Cycle | One fenced attempt to turn observations into hypotheses |
| Hypothesis | Falsifiable proposed improvement in `IMAGINED` state |
| Mutation contract | Approved surfaces and immutable rails for one repository |
| Candidate | Darwin-produced immutable variant in `PRODUCED` state |
| Evaluation | Candidate/baseline comparison over frozen suites |
| Anchor | Human-labelled suite never optimized against |
| Holdout | Sealed out-of-sample suite used for promotion evidence |
| Receipt | Signed canonical Flywheel evidence |
| Evidence epoch | One sequential-testing alpha stream |
| Qualified candidate | Candidate in `PROVED` state; not deployment-authorized |
| Authorization | Independent policy decision permitting a bounded action |
| Champion | Version currently selected for an environment |
| Promotion | Atomic champion transition with proof and authorization |

## Bounded contexts

| Context | Core aggregate | Owns | Upstream dependency |
|---|---|---|---|
| Observation | `EvidenceBatch` | normalized facts, provenance, quarantine | Ruflo trajectories, AgentDB/RuVector |
| Dream | `DreamCycle` | rotation, clustering, hypothesis formation | Ruflo workers, research-core |
| Evolution | `EvolutionCampaign` | mutation contract, Darwin archive, candidates | `@metaharness/darwin` |
| Evaluation | `EvaluationLineage` | anchors, holdouts, scores, receipts, alpha epochs | `@metaharness/flywheel`, RedBlue, test-bench |
| Governance | `PromotionAuthorization` | policy, approval, budget, capability envelope | policy-engine, enforcement, usage-ledger |
| Operations | `RepositoryEnrollment` | scheduling, leases, rollout, incidents, recovery | org-manifests, execution/orchestration, observatory |
| Brain Knowledge | `KnowledgeContribution` | cognitive memory, topology, drift, transfer, federation | RuVector Brain, RVF, SONA, π |
| Repository Integration | `RepositoryConnection` | GitHub installation, snapshots, change proposals | GitHub App, Ruflo/Jujutsu |
| Artifact Lineage | `ArtifactManifest` | immutable manifests, RVF, signatures, reachability | RVF, Flywheel receipts, CAS |
| Evaluation Corpus | `CorpusVersion` | train/anchor/holdout/adversarial truth lifecycle | test-bench, Flywheel |

## Context relationships

```text
Organization Manifest ──ACL──> Operations
Operations ──published language──> Observation
Observation ──customer/supplier──> Dream
Dream ──published language──> Evolution
Evolution ──customer/supplier──> Evaluation
Governance ──policy service──> Dream, Evolution, Evaluation, Operations
Evaluation ──qualified candidate──> Operations
Operations ──rollout telemetry──> Observation
Observation ──published language──> Brain Knowledge
Brain Knowledge ──retrieval/prior──> Dream, Evolution
Evaluation Corpus ──sealed suites──> Evaluation
Repository Integration ──snapshot/proposal──> Operations
Artifact Lineage ──manifest references──> all contexts
```

Contexts communicate only through the versioned envelope from ADR-002. Direct imports of another context's domain or infrastructure are forbidden. Synchronous queries use public application ports; state changes use outbox events.

## Shared kernel

Only identifiers, digest types, timestamps, tenant/repository identity, money, and the envelope schema are shared. Flywheel and Darwin types remain inside their anti-corruption layers to prevent upstream concepts leaking across all domains.

## Global invariants

1. Tenant and repository are explicit on every aggregate.
2. Trust transitions are monotonic and evidenced.
3. Evaluation cannot authorize; policy cannot manufacture evidence.
4. Dream cannot mutate; Darwin cannot promote; Flywheel cannot deploy.
5. Exactly one fenced writer owns a repository workspace.
6. Immutable evidence is never overwritten.
7. Serving pointers reference signed, replayable lineage.
8. Brain confidence, votes, propositions, and transfer priors never substitute for Flywheel proof or policy authorization.

## Validation

Ruflo DDD validation must run in CI: no direct cross-context domain imports, one repository per aggregate, immutable past-tense events carrying aggregate IDs, and infrastructure hidden from context public exports.
