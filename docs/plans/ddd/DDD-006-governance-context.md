# DDD-006: Governance context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Decide who may spend, evaluate, write, promote, reset evidence, or release, independently of scientific qualification.

## Aggregate: `PromotionAuthorization`

### State

`REQUESTED → APPROVED → CONSUMED`, with `DENIED|EXPIRED|REVOKED` terminal alternatives.

### Invariants

- Request identifies candidate, environment, champion version, evidence digest, action, envelope, requester, and policy epoch.
- Requester cannot approve their own irreversible action.
- Approval can narrow but never expand the requested envelope.
- Approval expires and has bounded uses; consumption is atomic.
- Deny/revoke overrides allow.
- Policy decision and evidence qualification are separate mandatory facts.

## Supporting aggregates

- `BudgetReservation`: ceiling, consumed amount, expiry, reconciliation.
- `CapabilityDelegation`: parent capability, narrowed child envelope, revocation.
- `TenantSecurityProfile`: identities, key aliases, retention and network policy.

## Commands

- `RequestPromotionAuthorization`
- `ApprovePromotion`, `DenyPromotion`, `RevokeAuthorization`
- `ConsumeAuthorization`
- `ReserveCycleBudget`, `RecordUsage`, `ReleaseBudget`
- `DelegateCapability`, `RevokeCapability`

## Events

- `PromotionAuthorizationRequested`, `PromotionApproved`, `PromotionDenied`
- `AuthorizationConsumed`, `AuthorizationExpired`, `AuthorizationRevoked`
- `BudgetReserved`, `UsageRecorded`, `BudgetReleased`
- `CapabilityDelegated`, `CapabilityRevoked`

## Domain services

- `PolicyDecisionService`: ACL over Agentics policy-engine and Ruflo action capabilities.
- `EnvelopeAlgebra`: proves child envelope is a subset along every dimension.
- `ApprovalVerifier`: validates identity, separation of duties, expiry, use count, and evidence binding.
- `BudgetAuthority`: coordinates atomic usage-ledger reservations.

## Failure semantics

Policy or ledger outage fails mutation/promotion closed. Read-only evidence verification remains available. Authorization consumption and champion compare-and-swap share one transaction boundary through an application-level saga with compensating release if promotion fails before commit.

## Tests

- Truth-table tests for allow/deny/approval precedence.
- Property tests for envelope subset algebra.
- Replay, expiry, revocation, concurrent use, and budget overspend tests.
- Cross-tenant and separation-of-duty tests.
- Policy epoch rollover and emergency rollback authorization tests.
