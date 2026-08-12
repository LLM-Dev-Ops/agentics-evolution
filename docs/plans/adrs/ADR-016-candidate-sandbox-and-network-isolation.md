# ADR-016: Candidate sandbox and network isolation

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: sandbox, gvisor, network, isolation

## Context

Darwin candidates and repository tests are untrusted code. Process isolation alone is insufficient for multi-tenant production execution.

## Decision

Run mutation and evaluation workloads as ephemeral Kubernetes Jobs on a dedicated GKE Autopilot cluster using GKE Sandbox/gVisor where supported, dedicated workload identities, and deny-by-default network policy.

- Each job receives a read-only source/CAS mount and bounded ephemeral writable volume.
- No host paths, Docker socket, privileged mode, service-account token automount, metadata-server access, or shared writable volumes.
- Seccomp/runtime default, non-root UID, read-only root filesystem, dropped capabilities, PID/CPU/memory/ephemeral-storage quotas, deadline and process limit are mandatory.
- Candidate code receives no secrets. A broker exposes only pre-authorized symbolic tools; model and signing calls remain outside the sandbox.
- Network is disabled by default. Evaluators needing package/test services use explicit egress proxies with destination and method allowlists, DNS rebinding protection, byte/time budgets, and recorded receipts.
- Darwin `inspectVariant` and `validateGeneratedCode` remain mandatory pre-admission gates; cluster isolation is defense in depth.

Images are digest-pinned and admission-controlled by signed provenance. Job cleanup is reconciled even after controller failure.

## Acceptance criteria

1. Escape, metadata, credential, DNS rebinding, fork bomb, disk fill, symlink, and exfiltration tests fail.
2. Quota/deadline termination produces a sealed failure trace and releases resources.
3. Cross-tenant jobs cannot observe process, network, volume, or cache state.
4. Only admission-approved image digests run.
5. Cluster unavailability prevents execution without losing campaign state.

## Links

- [ADR-004](ADR-004-darwin-bounded-mutation.md)
- MetaHarness Darwin safety model and RedBlue
