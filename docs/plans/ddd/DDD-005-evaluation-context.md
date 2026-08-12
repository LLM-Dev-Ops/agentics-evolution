# DDD-005: Evaluation context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Determine whether a produced candidate has replayable evidence of improvement and maintain the statistical evidence stream.

## Aggregate: `EvaluationLineage`

### Identity and state

One lineage per repository, anchor version, promotion-rule version, and evidence epoch. It owns baseline/champion references, attempts, alpha spend, receipts, resets, and qualified candidates.

### Invariants

- Anchor and gate fingerprints are immutable within a lineage.
- Every candidate attempt increments the sequential test index, promoted or rejected.
- An undersized sample does not spend alpha.
- Reset requires separate authorization, reason, fresh data, receipt expiry, and append-only audit.
- Qualification requires every conjunctive gate; Evaluation cannot authorize deployment.
- Historical receipts retain their original version semantics.

## Value objects

- `SuiteRef(id, version, sha256, itemCount, sealed)`
- `Score(primary, noopRate, costPerWin, regressed)`
- `SequentialVerdict(testIndex, alphaAllocated, eValue, threshold, informativePairs)`
- `ReceiptRef(schema, digest, signature, keyId)`
- `GateFingerprint(algorithm, digest)`

## Commands

- `RegisterProjectAnchor`
- `StartEvaluation`
- `RecordSuiteResult`
- `SealEvaluationReceipt`
- `QualifyCandidate`
- `RejectCandidateEvidence`
- `ResetEvidenceEpoch`
- `VerifyReplayBundle`

## Events

- `ProjectAnchorRegistered`, `EvaluationStarted`, `EvaluationCompleted`
- `CandidateQualified`, `CandidateRejectedByEvidence`
- `EvidenceEpochReset`, `ReplayBundleVerified`, `ReplayBundleInvalidated`

## Domain services

- `FlywheelAdapter`: maps test-bench results to upstream `Score` and delegates gate/receipt/lineage.
- `SequentialEvidencePolicy`: implements Ruflo ADR-381 semantics through the pinned upstream implementation.
- `RedBlueEvaluator`: converts adversarial findings into hard regression signals.
- `ReplayVerifier`: operates without production database trust using bundle, key, and pinned gate.

## Tests

- Differential tests against upstream Flywheel examples.
- Tamper matrix over every receipt and bundle field.
- Null simulations and power/preflight tests.
- Anchor replacement/evidence reset/version compatibility tests.
- Concurrent qualification and repeated-delivery idempotency tests.
