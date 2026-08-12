# ADR-015: GitHub repository integration

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: github, repositories, pr, permissions

## Context

The service must inspect repositories and optionally publish reviewed changes without using personal tokens or granting broad write access.

## Decision

Use a GitHub App installed per organization/repository with least-privilege permissions. Enrollment records installation ID, repository node ID, default branch, owners, and allowed write modes.

- Default permissions are metadata/content read, checks read, issues read, and pull requests read.
- Draft-PR mode additionally requests contents and pull-requests write; issue mode requests issues write.
- The service never merges, modifies branch protection, administers repositories, manages secrets, or publishes releases without a distinct future capability.
- Webhooks are signature-verified, delivery-idempotent, installation-bound, and fetched objects are revalidated through the API.
- Source snapshots pin commit SHA. Dirty local state is never used for remote evaluation.
- Candidate branches use deterministic names under `agentics-evolution/`, expected-head compare-and-swap, signed evidence links, and draft PRs.
- Worktrees are disposable and single-writer. Cleanup refuses unknown/dirty registry-owned worktrees and never deletes user branches.

Rate limits, abuse responses, revoked installations, force pushes, deleted branches, and repository transfer are explicit states handled by the ACL.

## Acceptance criteria

1. Permission tests prove read-only enrollment cannot write.
2. Forged/replayed webhooks, transferred repositories, and revoked installations fail safely.
3. Force-push between evaluation and PR creation invalidates the operation.
4. Draft PR content binds candidate, receipt, source SHA, tests, and rollback instructions.
5. No test path can merge a PR or bypass required reviews.

## Links

- [DDD-009](../ddd/DDD-009-repository-integration-context.md)
- Ruflo worktree/claims invariants and Jujutsu diff analysis
