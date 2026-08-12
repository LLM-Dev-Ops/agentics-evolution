# ADR-019: Signing keys and receipt verification

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: kms, signing, receipts, rotation

## Context

Flywheel uses Ed25519 receipts and replayable canonical payloads. Production keys must be non-exportable, tenant-scoped, rotatable, and independently verifiable.

## Decision

Preserve MetaHarness/Flywheel canonicalization and receipt schemas. Implement its `Signer` port with Cloud KMS asymmetric Ed25519 keys where available; if a required runtime cannot use KMS Ed25519, use a dedicated signing service backed by an HSM and document the compatible algorithm through a versioned receipt extension—never silently substitute.

- Separate keys for cycle witnesses, evaluation receipts, release provenance, and environments.
- Application/workers submit canonical digest and signing purpose; they cannot export private material.
- Receipt includes key ID/version, algorithm, schema, signed-at time, artifact digests, gate fingerprint, anchor, source snapshot, and policy decision when applicable.
- Public keys and status are published in an append-only key manifest. Rotation overlaps verification, while new signing switches atomically.
- Compromise revocation prevents new trust but does not rewrite history; receipts are reported with signing-time validity and revocation metadata.
- Offline verifier consumes bundle, public-key manifest, pinned gate fingerprint, and optional transparency checkpoint without service/database trust.

## Acceptance criteria

1. Flywheel upstream receipt fixtures verify through the production signer adapter.
2. Byte tampering, wrong purpose/tenant/key, revoked key, and algorithm downgrade fail.
3. Rotation preserves historical verification and moves new signatures once.
4. Workers cannot request arbitrary signatures outside their capability.
5. Offline verification is documented, packaged, and exercised in release CI.

## Links

- Ruflo ADR-322C and MetaHarness Flywheel signer/verification
- [DDD-010](../ddd/DDD-010-artifact-lineage-context.md)
