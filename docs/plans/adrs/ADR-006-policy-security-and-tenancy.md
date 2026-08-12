# ADR-006: Policy, security, and tenant isolation

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: policy, security, tenancy, authorization

## Context

The system executes untrusted candidate code and may prepare repository changes. A scheduler lease or Flywheel proof is not authorization. Multi-tenant data, keys, budgets, and workspaces must not cross boundaries.

## Decision

Use Agentics policy-engine as the organization authority and align decisions with Ruflo's action-capability and shrinking-envelope model.

### Capabilities

Define explicit actions: `cycle.read`, `cycle.run`, `candidate.generate`, `candidate.evaluate`, `evidence.reset`, `promotion.qualify`, `promotion.authorize`, `rollout.start`, `rollout.rollback`, `repository.write`, and `release.publish`.

- Default deny; deny overrides allow and approval.
- Delegation can only reduce repositories, paths, tools, network, spend, concurrency, expiry, and depth.
- Promotion authorization requires a human or separately configured approval authority; self-approval is forbidden.
- Destructive or irreversible actions require short-lived, single-purpose approvals with replay limits.
- Policy is evaluated before side effects and its decision digest is embedded in receipts.

### Isolation

- Tenant ID is mandatory in every primary key, queue message, object-store prefix, vector namespace, metric label policy, and signing-key lookup.
- Workloads use per-run service identities and short-lived credentials from a secret manager; secrets are never placed in candidate environments.
- Network egress is deny-by-default with destination allowlists and DNS/IP rebinding defenses.
- Receipt signing uses managed asymmetric keys; workers request signatures over canonical digests and cannot export private keys.
- External content passes AIDefence, tool-output, memory-poisoning, and MCP composition scans.

### Supply chain

Production images are digest-pinned, signed, SBOM-attested, vulnerability-scanned, and built from a clean source receipt. Package install scripts are disabled unless allowlisted.

## Acceptance criteria

1. Cross-tenant access tests fail at API, database, queue, object, vector, and metrics layers.
2. Self-approval, expired approval, replay, revoked approval, and envelope expansion fail closed.
3. Concurrent budget reservations cannot overspend.
4. Candidate escape and egress penetration tests pass.
5. Signing keys cannot be read by application or worker processes.
6. Policy-engine unavailability blocks mutations and promotions while read-only status remains available.
7. Audit logs contain no secrets or raw unredacted prompts.

## Links

- [DDD-006](../ddd/DDD-006-governance-context.md)
- Ruflo ADR-324 and AGENTS.md hard invariants
- Darwin safety model and MetaHarness RedBlue
