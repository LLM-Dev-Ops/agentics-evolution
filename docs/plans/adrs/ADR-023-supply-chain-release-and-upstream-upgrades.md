# ADR-023: Supply chain, release, and upstream upgrades

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: supply-chain, release, sbom, upgrades

## Context

The system depends on rapidly evolving pre-1.0 Ruvnet packages and produces privileged automation. Compromised dependencies or unverified builds would invalidate the trust chain.

## Decision

Build with pinned lockfile integrity in hermetic CI. Generate CycloneDX SBOM, SLSA-compatible provenance, vulnerability/license reports, test evidence, and image signatures. Admission accepts only release-manifest image digests signed by the release key.

- Install scripts are disabled except explicit reviewed allowlists.
- Dependencies are scanned for typosquatting, maintainer/provenance change, unexpected native code, and license drift.
- Ruvnet upgrades follow ADR-009 compatibility campaign and run upstream smoke/tests, golden Dream/Darwin/Flywheel replay, receipt verification, deterministic fixtures, performance/cost comparison, and rollback rehearsal.
- Release manifest binds source commit, dirty-state prohibition, dependencies, schemas, migrations, image digests, SBOM, ADR conformance, gate fingerprint, and verification commands.
- Production publication requires a distinct `release.publish` authorization. CI success cannot self-authorize.
- Emergency patches follow the same provenance/signing and receive retrospective full-suite evidence before normal operation resumes.

## Acceptance criteria

1. Clean-room verifier validates source-to-image and release manifest.
2. Unpinned/unsigned/unscanned artifacts fail CI and admission.
3. Simulated malicious dependency and maintainer-change alerts block upgrade.
4. Previous release remains deployable and database-compatible through canary rollback.
5. Upstream conformance report is present for every changed Ruvnet package.

## Links

- [ADR-009](ADR-009-upstream-conformance-and-anti-drift.md)
- Ruflo witness/release invariants and Agentics forge
