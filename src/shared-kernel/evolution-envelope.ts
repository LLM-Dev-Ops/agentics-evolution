import { AggregateId, ActorId, CycleId, RepositoryId, TenantId, actorId, aggregateId, cycleId, repositoryId, tenantId } from "./identity.js";
import { DigestReference, digestBytes, digestReference } from "./digest.js";
import { SourceSnapshot, sourceSnapshot } from "./source-snapshot.js";
import { UtcInstant, utcInstant } from "./time.js";
import { CausationId, CorrelationId, EventId, IdempotencyKey, causationId, correlationId, eventId, idempotencyKey } from "./uuid-v7.js";
import { canonicalJson, deepFreeze } from "./immutable.js";
import type { EnvelopeSchemaRegistry } from "./schema-registry.js";
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
  eventId(input.id); tenantId(input.tenantId); repositoryId(input.repositoryId); aggregateId(input.aggregateId); cycleId(input.cycleId); actorId(input.actorId);
  utcInstant(input.occurredAt); causationId(input.causationId); correlationId(input.correlationId); idempotencyKey(input.idempotencyKey);
  sourceSnapshot(input.sourceRef);
  for (const reference of input.evidence) digestReference(reference);
  const inspectScope = (value: unknown, depth = 0): void => {
    if (depth > 32) throw new TypeError("envelope nesting exceeds 32 levels");
    if (Array.isArray(value)) { for (const item of value) inspectScope(item, depth + 1); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError("unsafe envelope object key");
      if (key === "tenantId" && nested !== input.tenantId) throw new TypeError("cross-tenant envelope reference");
      if (key === "repositoryId" && nested !== input.repositoryId) throw new TypeError("cross-repository envelope reference");
      inspectScope(nested, depth + 1);
    }
  };
  inspectScope(input.payload);
  const canonical = canonicalJson(input);
  if (Buffer.byteLength(canonical) > 1_048_576) throw new TypeError("envelope exceeds one MiB");
  return deepFreeze(structuredClone(input)) as Readonly<EvolutionEnvelope<P>>;
}
export const encodeEnvelope = (value: EvolutionEnvelope): Uint8Array => new TextEncoder().encode(canonicalJson(value));
export const envelopeDigest = (value: EvolutionEnvelope) => digestBytes(encodeEnvelope(value));
export function decodeEnvelope(bytes: Uint8Array, registry: EnvelopeSchemaRegistry): Readonly<EvolutionEnvelope> {
  if (bytes.byteLength > 1_048_576) throw new TypeError("envelope exceeds one MiB");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new TypeError("INVALID_ENVELOPE_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("INVALID_ENVELOPE_OBJECT");
  const envelope = createEnvelope(parsed as EvolutionEnvelope);
  registry.validate(envelope);
  return envelope;
}
