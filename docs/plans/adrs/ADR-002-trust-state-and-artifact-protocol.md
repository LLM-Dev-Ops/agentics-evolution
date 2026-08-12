# ADR-002: Trust-state and artifact protocol

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: contracts, trust, provenance, events

## Context

Dream output, Darwin candidates, evaluation results, and authorized releases have different evidentiary status. Treating them as interchangeable would permit an LLM hypothesis to become trusted memory or deployed configuration.

## Decision

Adopt four monotonic trust states:

1. `IMAGINED`: a sourced hypothesis; cannot mutate or execute.
2. `PRODUCED`: an immutable Darwin candidate admitted by safety rails.
3. `PROVED`: Flywheel replay passes all frozen gates; not deployable by itself.
4. `AUTHORIZED`: a separate valid policy decision permits a specified promotion action.

No state transition is inferred. Every transition consumes a versioned command and emits an append-only domain event with actor, tenant, repository, source snapshot, policy epoch, evidence digest, timestamp, and idempotency key.

### Envelope

All cross-context messages use `agentics.evolution-envelope/v1`:

```json
{
  "id": "uuidv7",
  "type": "HypothesisProposed",
  "tenantId": "tenant",
  "repositoryId": "repo",
  "cycleId": "cycle",
  "occurredAt": "RFC3339",
  "schemaVersion": 1,
  "causationId": "uuidv7",
  "correlationId": "uuidv7",
  "sourceRef": { "commit": "sha", "dirtySnapshot": null },
  "payload": {},
  "evidence": [{ "uri": "cas://sha256/...", "sha256": "..." }]
}
```

Schemas live in the organization contract registry and are compatibility-checked. Payloads are immutable; corrections append superseding events. At-least-once delivery is assumed, so consumers must enforce `(tenantId,idempotencyKey)` uniqueness.

### State transition table

| From | Command | Gate | To |
|---|---|---|---|
| none | `ProposeHypothesis` | source/provenance validation | `IMAGINED` |
| `IMAGINED` | `GenerateCandidate` | mutation eligibility + immutable rails | `PRODUCED` |
| `PRODUCED` | `AcceptEvaluation` | anchor, holdout, red-team, receipt replay, sequential evidence | `PROVED` |
| `PROVED` | `AuthorizePromotion` | independent policy capability and approval | `AUTHORIZED` |

Revocation never rewrites history. It appends `AuthorizationRevoked` or `ChampionRolledBack` and advances the serving pointer atomically.

## Consequences

### Positive

- Trust is inspectable and machine-enforceable.
- Replay can reconstruct every decision without trusting mutable databases.

### Negative

- Event evolution and idempotency add operational complexity.

## Acceptance criteria

1. Property tests prove no transition skips a state.
2. Replayed events reconstruct identical aggregate state.
3. Duplicate commands cannot create duplicate candidates, evaluations, or promotions.
4. Tampering with any referenced artifact invalidates replay.
5. Schemas reject cross-tenant identifiers and unknown critical fields.
6. A `PROVED` candidate without authorization is impossible to serve.

## Links

- [DDD-001](../ddd/DDD-001-context-map-and-ubiquitous-language.md)
- [ADR-005](ADR-005-flywheel-evaluation-and-promotion.md)
- Ruflo ADR-322C receipt ledger verification
