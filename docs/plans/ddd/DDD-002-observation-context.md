# DDD-002: Observation context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Convert heterogeneous, untrusted inputs into immutable, typed, provenance-bearing observations suitable for retrieval and Dream processing.

## Aggregate: `EvidenceBatch`

### Identity and state

`EvidenceBatchId`, tenant, repository, source snapshot, capture window, source adapter, status (`OPEN|SEALED|QUARANTINED`), observations, manifest digest.

### Invariants

- Only an open batch accepts observations.
- Every observation has content digest, source URI/type, captured time, trust class, redaction result, and schema version.
- Raw secrets and prohibited personal data cannot enter the canonical artifact store.
- Sealing computes a deterministic manifest; sealed batches are immutable.
- Quarantined items never enter embeddings or model context.

## Value objects

- `EvidenceRef(uri, sha256, mediaType)`
- `SourceSnapshot(commitSha | dirtySnapshotDigest)`
- `CaptureWindow(start, end)`
- `EvidenceGrade(A|B|C|UNVERIFIED)`
- `TrustClass(INTERNAL_VERIFIED|INTERNAL_UNVERIFIED|EXTERNAL_UNTRUSTED)`
- `RedactionReport(detectors, removedFields, digest)`

## Commands

- `OpenEvidenceBatch`
- `CaptureObservation`
- `QuarantineObservation`
- `SealEvidenceBatch`
- `ExpireObservation`
- `SupersedeObservation`

## Events

- `EvidenceBatchOpened`
- `ObservationCaptured`
- `ObservationQuarantined`
- `EvidenceBatchSealed`
- `ObservationExpired`
- `ObservationSuperseded`

## Domain services

- `EvidenceNormalizer`: maps adapter payloads to published language.
- `ContentSafetyClassifier`: composes redaction, AIDefence, tool-output, and poisoning scans.
- `ProvenanceVerifier`: verifies source snapshots and artifact hashes.
- `ObservationDeduplicator`: exact digest then RuVector semantic similarity, never auto-merging contrary evidence.

## Ports and adapters

Inbound adapters: Ruflo trajectories/ReasoningBank, Git/CI, incident manager, human corrections, usage ledger, research-core. Outbound ports: CAS, event store, RuVector projection, outbox.

## Consistency and failure

Capture is idempotent on `(tenant,repository,source,digest)`. CAS persistence precedes event commit; abandoned objects are garbage-collected after the retention window. A vector projection failure does not unseal evidence and is retried from the outbox.

## Tests

- Contract fixtures for every adapter.
- Property tests for deterministic normalization and sealing.
- Injection, secret, PII, malformed encoding, decompression bomb, and oversized input tests.
- Projection rebuild and contrary-evidence preservation tests.
