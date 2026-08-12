# DDD-009: Repository Integration context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Own the relationship with a source repository, GitHub installation, snapshots, proposed changes, and delivery receipts.

## Aggregate: `RepositoryConnection`

States: `PENDING → VERIFIED → ACTIVE`, with `SUSPENDED|REVOKED|TRANSFERRED`.

### Invariants

- Installation and repository node IDs, not mutable names, define identity.
- Permissions are recorded and checked before every operation.
- Snapshot SHA is immutable for a candidate/evaluation lineage.
- Write mode is `NONE|ISSUE|DRAFT_PR`; merge/release is never implied.
- Force-push or installation transfer invalidates pending delivery.

## Aggregate: `ChangeProposal`

States: `PREPARED → PUBLISHED → CLOSED`, with `STALE|REJECTED|SUPERSEDED`.

It binds source SHA, candidate/RVF artifact, Flywheel receipt, authorization, branch/head SHA, draft PR or issue, expected reviewers, and rollback instructions.

## Commands and events

Commands: `VerifyInstallation`, `ActivateConnection`, `CaptureSnapshot`, `PrepareChangeProposal`, `PublishDraftPullRequest`, `MarkProposalStale`, `RevokeConnection`.

Events use past tense and carry repository aggregate IDs. Webhook deliveries are facts consumed through an inbox, never direct state mutations.

## Tests

GitHub App permission, webhook, rate-limit, transfer, force-push, expected-head, revoked-installation, worktree fencing, and no-merge capability tests are mandatory.
