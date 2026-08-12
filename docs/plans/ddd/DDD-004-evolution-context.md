# DDD-004: Evolution context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Convert eligible hypotheses into safely bounded Darwin candidates and preserve the complete archive.

## Aggregate: `EvolutionCampaign`

### State

`PLANNED → BASELINED → EVOLVING → CHECKPOINTED → COMPLETED`, or `BLOCKED|CANCELLED|EXHAUSTED`.

### Invariants

- Campaign source snapshot, hypothesis, mutation contract, Darwin config, budget, and runtime image are immutable after start.
- Only allowlisted surfaces may mutate; immutable rails are outside the mutation genome.
- A candidate has exactly one parent except the baseline.
- Safety rejection occurs before execution/evaluation and is retained.
- The campaign cannot declare a candidate proved or authorized.

## Entities and value objects

- `MutationContract(allowedSurfaces, protectedPaths, tools, network, quotas)`
- `DarwinConfiguration(seed, generations, children, concurrency, selection)`
- `Candidate(candidateId, parentId, surface, artifactDigest, safetyVerdict)`
- `CampaignCheckpoint(archiveDigest, pendingWork, budgetState)`

## Commands

- `PlanEvolutionCampaign`
- `CreateBaselineCandidate`
- `GenerateCandidate`
- `RejectUnsafeCandidate`
- `RecordCandidateExecution`
- `CheckpointCampaign`
- `CompleteCampaign`
- `CancelCampaign`

## Events

- `EvolutionCampaignPlanned`, `BaselineCandidateCreated`
- `CandidateProduced`, `CandidateRejectedBySafetyRails`
- `CampaignCheckpointed`, `EvolutionCampaignCompleted`

## Domain services

- `MutationEligibilityPolicy`: validates hypothesis/surface/authorization.
- `DarwinAdapter`: calls `@metaharness/darwin` without changing its archive semantics.
- `SandboxAdmission`: composes upstream inspections with Agentics capability envelope.
- `ArchiveProjector`: persists Darwin archive and exposes candidate summaries.

## Infrastructure contracts

Execution-engine supplies isolated workspaces with fencing tokens and cancellation. Usage-ledger supplies reservation/actual reconciliation. CAS stores variants, traces, and checkpoints. Queue messages contain identifiers and digests, never unbounded candidate source.

## Tests

- Upstream Darwin contract suite pinned to the selected version.
- Protected-file/symlink/shell/network/secret escape tests.
- Determinism and archive-resume tests.
- Worker crash at every checkpoint boundary.
- Fanout, quota, timeout, and cancellation stress tests.
