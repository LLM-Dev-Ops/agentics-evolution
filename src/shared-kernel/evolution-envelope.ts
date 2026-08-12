import { AggregateId, ActorId, CycleId, RepositoryId, TenantId } from "./identity.js";
import { DigestReference, digestBytes } from "./digest.js";
import { SourceSnapshot } from "./source-snapshot.js";
import { UtcInstant } from "./time.js";
import { CausationId, CorrelationId, EventId, IdempotencyKey } from "./uuid-v7.js";
import { canonicalJson, deepFreeze } from "./immutable.js";
export const ENVELOPE_SCHEMA = "agentics.evolution-envelope/v1" as const;
export interface EvolutionEnvelope<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly envelopeSchema: typeof ENVELOPE_SCHEMA; readonly schemaVersion: 1; readonly id: EventId; readonly type: string;
  readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly aggregateId: AggregateId; readonly cycleId: CycleId;
  readonly actorId: ActorId; readonly occurredAt: UtcInstant; readonly causationId: CausationId; readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey; readonly policyEpoch: number; readonly sourceRef: SourceSnapshot;
  readonly evidence: readonly DigestReference[]; readonly payload: Readonly<P>;
}
const KEYS = new Set(["envelopeSchema", "schemaVersion", "id", "type", "tenantId", "repositoryId", "aggregateId", "cycleId", "actorId", "occurredAt", "causationId", "correlationId", "idempotencyKey", "policyEpoch", "sourceRef", "evidence", "payload"]);
export function createEnvelope<P extends Record<string, unknown>>(input: EvolutionEnvelope<P>): Readonly<EvolutionEnvelope<P>> {
  for (const key of Object.keys(input)) if (!KEYS.has(key)) throw new TypeError(`unknown critical envelope field: ${key}`);
  if (input.envelopeSchema !== ENVELOPE_SCHEMA || input.schemaVersion !== 1) throw new TypeError("unknown envelope schema version");
  if (!/^[A-Z][A-Za-z0-9]*(?:ed|Generated|Proposed|Accepted|Authorized|Revoked|RolledBack)$/.test(input.type)) throw new TypeError("domain event type must be past tense");
  if (!Number.isSafeInteger(input.policyEpoch) || input.policyEpoch < 0) throw new TypeError("policyEpoch must be non-negative");
  canonicalJson(input.payload);
  return deepFreeze(structuredClone(input)) as Readonly<EvolutionEnvelope<P>>;
}
export const encodeEnvelope = (value: EvolutionEnvelope): Uint8Array => new TextEncoder().encode(canonicalJson(value));
export const envelopeDigest = (value: EvolutionEnvelope) => digestBytes(encodeEnvelope(value));
