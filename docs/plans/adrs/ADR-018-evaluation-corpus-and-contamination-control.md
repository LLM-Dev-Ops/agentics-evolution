# ADR-018: Evaluation corpus and contamination control

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: evaluation, anchor, holdout, contamination

## Context

Flywheel proof is meaningless if Darwin or Dream sees holdout answers, if suites change silently, or if test selection leaks outcomes.

## Decision

Create a Corpus lifecycle owned by Evaluation and backed by test-bench plus CAS.

- `ANCHOR`: human-labelled, visible to evaluators but never mutation optimization.
- `TRAIN`: available to Dream/Darwin for diagnosis and candidate search.
- `HOLDOUT`: sealed, encrypted, evaluator-only, unavailable to model prompts and retrieval.
- `ADVERSARIAL`: RedBlue suites with protected expected results.
- `CANARY`: live behavioral metrics with no gold answers.

Every suite has schema, semantic version, canonical digest, provenance, labels, owner, license, creation process, decontamination report, and minimum sample policy. Split assignment is deterministic from a secret keyed hash after deduplication, stratified by task class, and immutable within an evidence epoch.

Holdout access occurs inside a dedicated evaluator identity. Candidate workers receive only per-task opaque IDs and final normalized results. Logs redact expected answers. Corpus replacement creates a new lineage and requires evidence reset authorization.

Periodic contamination scans compare prompts, memory, candidate artifacts, and training evidence against protected n-grams/embeddings without exposing answers.

## Acceptance criteria

1. Access-control tests prove Dream, Darwin, operators without evaluator role, and candidates cannot read holdout content.
2. Duplicate/near-duplicate tasks cannot cross train/holdout boundaries.
3. Suite edits change digest and invalidate old manifests.
4. Contamination fixtures block qualification and open an incident.
5. Statistical power and representativeness reports accompany every active suite.

## Links

- [DDD-011](../ddd/DDD-011-evaluation-corpus-context.md)
- Ruflo ADR-331 and MetaHarness Flywheel anti-Goodhart design
