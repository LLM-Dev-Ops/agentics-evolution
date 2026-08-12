# DDD-010: Artifact Lineage context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Own immutable artifact manifests, RVF cognitive containers, signature references, reachability, supersession, retention class, and independent verification.

## Aggregate: `ArtifactManifest`

An artifact manifest contains canonical digest, schema/media type, tenant/repository, producer, source snapshot, ordered dependencies, classification, retention, key/version, signature, RVF reference when applicable, and status `STAGED|SEALED|REVOKED|EXPIRED`.

### Invariants

- Sealed bytes and dependency order never change.
- A manifest seals only after every dependency is sealed and digest-verified.
- Revocation appends status evidence and never removes historical verification data.
- Promoted lineage and active legal holds are always reachable roots.
- RVF witness and Agentics CAS digest must agree on the bound content set.

## Domain services

- `Canonicalizer`: delegates Flywheel/RVF canonical formats.
- `ManifestSealer`: verifies dependencies then obtains purpose-bound signature.
- `ReachabilityPolicy`: computes garbage-collection roots.
- `OfflineVerifier`: validates CAS/RVF, signatures, gate, lineage, and key manifest.

## Tests

Golden canonicalization, cyclic dependency, missing object, tampering, key rotation/revocation, RVF import/export, reachability, retention, and clean-machine offline verification tests are required.
