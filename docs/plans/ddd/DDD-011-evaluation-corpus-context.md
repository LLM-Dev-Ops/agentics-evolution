# DDD-011: Evaluation Corpus context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Own creation, classification, sealing, access, contamination checks, replacement, and retirement of evaluation suites.

## Aggregate: `CorpusVersion`

States: `DRAFT → REVIEWED → SEALED → ACTIVE`, with `RETIRED|CONTAMINATED|REVOKED`.

### Invariants

- Tasks have provenance, license, labels, expected-result commitment, and dedupe fingerprint.
- Train, anchor, holdout, adversarial, and canary roles are mutually explicit.
- Holdout plaintext is accessible only to evaluator identity.
- Cross-split exact/semantic duplicates are rejected.
- Active suite bytes and split assignment are immutable.
- Replacement creates a new evidence lineage and requires governed reset.

## Commands and events

Commands: `DraftCorpus`, `AddTask`, `RunDeduplication`, `ReviewCorpus`, `SealCorpus`, `ActivateCorpus`, `ReportContamination`, `RetireCorpus`.

Events: `CorpusDrafted`, `TaskAdded`, `CorpusDeduplicated`, `CorpusSealed`, `CorpusActivated`, `CorpusContaminated`, `CorpusRetired`.

## Tests

Split secrecy, dedupe, deterministic secret-key assignment, access audit, contamination, digest, statistical power, corpus replacement, and historical replay compatibility tests are required.
