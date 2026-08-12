# ADR-017: Model routing and provider execution

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: models, routing, budgets, providers

## Context

Dream and Darwin need model calls, but provider-specific logic, uncontrolled escalation, and unrecorded prompts would make results irreproducible and costs unsafe.

## Decision

Use Ruflo's routing/trajectory hooks as the orchestration authority and `@metaharness/router` for measured cost-quality selection. Agentics supplies a provider gateway port and budget enforcement.

- Requests declare task class, criticality, data classification, quality bar, maximum spend/tokens/time, allowed providers/models, and fallback policy.
- The router chooses the cheapest candidate predicted to clear the quality bar. Frontier escalation requires an explicit capability and regret/budget gate; it is never triggered solely by uncertainty.
- Provider credentials remain in the gateway, not Ruflo workers or sandboxes.
- Every call records provider/model revision, route decision, prompt-template digest, canonical input digest, sampling parameters, token/cost/latency, cache status, tool schema digest, response digest, and safety verdict.
- Prompts are versioned artifacts. External evidence is delimited as data and scanned before use.
- Retry occurs only for classified transient failures, with bounded attempts and no duplicate tool side effects. Fallback cannot weaken data residency, safety, or budget policy.
- Actual usage reconciles atomically with agentics-usage-ledger reservations.

Training data for the router comes only from verified outcomes and turn-credit receipts. Evaluation holdout contents are excluded.

## Acceptance criteria

1. Routing fixtures reproduce decisions with a pinned model catalog and observations.
2. Budget, residency, forbidden-model, provider-outage, retry, and fallback tests pass.
3. No credential appears in worker environment, trace, prompt, or artifact.
4. Cost reconciliation detects missing/duplicate provider usage.
5. A route decision can be audited from receipt to underlying verified outcomes.

## Links

- Ruflo model router, trajectory hooks, ReasoningBank
- `@metaharness/router` and `@metaharness/turn-credit`
