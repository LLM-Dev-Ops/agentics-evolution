# ADR-005: Flywheel evaluation and promotion

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: flywheel, evaluation, promotion, receipts

## Context

Candidate quality must be demonstrated out of sample and remain independently replayable. Repeated adaptive testing must not silently inflate false-promotion probability.

## Decision

Use `@metaharness/flywheel` for evaluation, gate fingerprinting, Ed25519 receipts, lineage, lift curves, and replay. Adopt Ruflo ADR-322's atomic promotion transaction, ADR-331 project-local anchors, and ADR-381 sequential evidence epochs.

### Evaluation suites

Every repository must enroll:

- a human-labelled, hash-pinned anchor suite of at least four tasks;
- a sealed holdout unavailable to Dream and Darwin;
- regression/security/policy tests;
- RedBlue adversarial cases appropriate to its tool surface;
- cost and latency budgets sourced from the usage ledger.

Foreign repositories never fall back to Ruflo's built-in anchors. Changing an anchor creates a new evaluation lineage and requires human approval.

### Frozen conjunctive gate

Promotion qualification requires all of:

1. primary metric exceeds baseline by the declared minimum effect;
2. no anchor or regression loss;
3. no safety, policy, secret, or destructive-action violation;
4. cost per win and p95 latency remain within envelope;
5. RedBlue severity threshold passes;
6. receipt signature, artifact digests, and gate fingerprint verify;
7. anytime-valid sequential evidence passes at the allocated alpha;
8. holdout has enough informative pairs before alpha is spent.

The gate is versioned, frozen for an evidence epoch, and excluded from mutation. Rejected candidates remain in lineage.

### Promotion transaction

Qualification creates `PROVED`; it never deploys. Authorization is separately obtained from the Governance context. Promotion uses compare-and-swap over `(repository, environment, championVersion)`, appends the receipt and policy decision, updates the champion pointer, and writes an outbox event in one transaction. A crash before commit changes nothing; a crash after commit is recovered from the outbox.

### Rollout

Authorized candidates progress through `shadow → canary → production`. Each stage has minimum observation volume, drift limits, and automatic rollback. Rollback advances to a prior signed champion; it never deletes lineage.

## Acceptance criteria

1. `verifyReplayBundle` independently validates a production promotion on a clean machine.
2. Tampered score, gate, anchor, receipt, or artifact fails verification.
3. Null simulations demonstrate the configured per-epoch false-promotion bound.
4. Undersized holdouts fail without consuming alpha.
5. Concurrent promoters yield exactly one champion.
6. Canary regression automatically restores the prior champion and emits an incident.
7. No API path can move `PROVED` to serving without current authorization.

## Links

- [DDD-005](../ddd/DDD-005-evaluation-context.md)
- Ruflo ADR-322, ADR-322C, ADR-331, ADR-381
- MetaHarness Flywheel `runFlywheelGenerations`, `meetsPromotionRule`, `verifyReplayBundle`
