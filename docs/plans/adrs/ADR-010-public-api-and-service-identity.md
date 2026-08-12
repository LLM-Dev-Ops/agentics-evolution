# ADR-010: Public API and service identity

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: api, identity, idempotency, openapi

## Context

Operators, schedulers, GitHub, and workers need a stable control surface. Authentication and idempotency cannot be inferred per endpoint.

## Decision

Expose a versioned JSON REST API described by OpenAPI 3.1. Use `/v1` resources for enrollments, cycles, evidence, hypotheses, campaigns, candidates, evaluations, authorizations, rollouts, receipts, and verification.

- Human access uses organization OIDC with MFA and group claims.
- Workloads use short-lived Google service-account identity tokens with explicit audience.
- GitHub webhooks use GitHub App signatures and installation identity.
- Authorization delegates to the Governance context; authentication middleware never grants domain capability.
- Mutating requests require `Idempotency-Key`; responses persist request digest, result reference, and expiry.
- Optimistic changes require ETag/`If-Match`; champion transitions additionally use domain compare-and-swap.
- Cursor pagination is opaque and tenant-bound. Errors use RFC 9457 problem details with stable codes and correlation IDs.
- OpenAPI schemas import canonical contracts from `agentics-contracts`; generated clients cannot define alternate schemas.

Read APIs may serve during policy/provider degradation. Mutation/evaluation/promotion endpoints fail closed when their authorities are unavailable.

## Acceptance criteria

1. OpenAPI lint, backward-compatibility, generated-client, and fuzz tests pass.
2. Reusing an idempotency key with a different body returns conflict.
3. Tenant, repository, and object enumeration attacks reveal no existence information.
4. Expired/incorrect-audience tokens and forged webhook signatures fail.
5. Every mutating endpoint maps to exactly one application command and policy action.

## Links

- [ADR-002](ADR-002-trust-state-and-artifact-protocol.md)
- [ADR-006](ADR-006-policy-security-and-tenancy.md)
