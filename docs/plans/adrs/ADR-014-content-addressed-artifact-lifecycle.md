# ADR-014: Content-addressed artifact lifecycle

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: cas, gcs, artifacts, retention

## Context

Snapshots, candidate variants, archives, traces, reports, suites, receipts, and replay bundles are too large for events and must be immutable.

## Decision

Use regional Google Cloud Storage buckets with uniform access, versioning, retention lock for audit classes, CMEK, and content-addressed object names.

Object identity is `sha256` of canonical bytes. Metadata records schema, media type, size, tenant, repository, classification, producer, source snapshot, and creation time. A write stages to a temporary object, verifies digest and size, then creates the immutable final object only if absent.

Artifact classes define retention: operational scratch, candidate archive, evaluation evidence, authorization/audit, and legal hold. Domain records reference `cas://sha256/<digest>`; signed manifests bind ordered artifact sets. Signed URLs are short-lived, audience-limited, and never issued to candidate sandboxes.

Garbage collection is mark-and-sweep from database roots plus retention/legal-hold rules. It cannot delete any artifact reachable from promoted lineage, active evidence epoch, incident, or audit requirement.

## Acceptance criteria

1. Digest collision/mismatch, partial upload, overwrite, oversized object, and wrong-tenant access fail.
2. A replay bundle copied to a clean verifier works without database/object metadata trust.
3. Garbage collection preserves all reachable and retained objects under concurrent writes.
4. Lifecycle and legal-hold tests match the privacy/retention policy.
5. Cross-region replication and restore verification are exercised quarterly.

## Links

- [DDD-010](../ddd/DDD-010-artifact-lineage-context.md)
- [ADR-007](ADR-007-storage-provenance-and-recovery.md)
