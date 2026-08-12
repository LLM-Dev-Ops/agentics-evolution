# ADR-024: Business continuity and disaster recovery

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: disaster-recovery, continuity, restore

## Context

ADR-007 sets recovery objectives but a complete recovery order and degraded operating mode are required to avoid unsafe writes after an outage.

## Decision

Maintain a warm recovery region for immutable artifacts and infrastructure definitions, Cloud SQL cross-region replica/backups, replicated release/key manifests, and recreated Pub/Sub subscriptions from Terraform.

Recovery order is identity/KMS → database → CAS → event transport → read API/verifier → scheduler → mutation/evaluation workers → rollout controller. Until reconciliation passes, the system is read-only and all promotions/alpha resets/releases are denied.

The recovery controller verifies:

- database checkpoint and event/outbox consistency;
- champion pointers and their complete signed lineage;
- active evidence epochs and alpha ledger;
- outstanding approvals/budgets/leases, expiring unsafe remnants;
- CAS reachability and sampled/full critical digest checks;
- deployed image and policy epoch.

Queue work is reconstructed from durable state, not trusted from broker backlog. In-flight candidate jobs are cancelled and resumed from signed checkpoints. DNS/traffic cutover requires human incident authorization.

RPO is 5 minutes for transaction state and zero for committed immutable evidence; RTO is 60 minutes for read/verification and 4 hours for full scheduled processing.

## Acceptance criteria

1. Semiannual game day restores an isolated environment from backups and meets RPO/RTO.
2. Restored verifier validates every active champion and sampled historical receipts.
3. No promotion occurs before reconciliation and explicit write-enable authorization.
4. Duplicate/resumed work remains idempotent after regional cutover.
5. Lost-region, corrupt-backup, lost-queue, key-revocation, and partial-CAS scenarios have exercised runbooks.

## Links

- [ADR-007](ADR-007-storage-provenance-and-recovery.md)
- [ADR-021](ADR-021-gcp-production-topology-and-environments.md)
