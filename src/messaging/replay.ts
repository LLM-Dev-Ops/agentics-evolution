import { createPublicKey, verify } from "node:crypto";
import type { EvolutionEnvelope } from "../shared-kernel/evolution-envelope.js";
import { canonicalJson, deepFreeze } from "../shared-kernel/immutable.js";
import type { PostgresLocalTransport } from "./postgres-local-transport.js";
import type { TransportMessage } from "./transport.js";

const replayCapabilityBrand: unique symbol = Symbol("VerifiedReplayCapability");
export interface ReplayCapabilityStatement { readonly schema: "agentics.replay-capability/v1"; readonly replayId: string; readonly issuer: string;
  readonly tenantId: string; readonly repositoryId: string; readonly eventTypes: readonly string[]; readonly expiresAt: string; }
export interface VerifiedReplayCapability { readonly [replayCapabilityBrand]: true; readonly statement: ReplayCapabilityStatement; }
export interface ReplayEffectPolicy { readonly replay: true; readonly replayId: string; readonly allowExternalEffects: boolean;
  readonly allowNormalTopicPublish: false; readonly tenantId: string; readonly repositoryId: string; }

export class ReplayCapabilityVerifier {
  readonly #keys: ReadonlyMap<string, ReturnType<typeof createPublicKey>>;
  constructor(keys: Readonly<Record<string, string>>) {
    this.#keys = new Map(Object.entries(keys).map(([issuer, pem]) => [issuer, createPublicKey(pem)]));
    if (!this.#keys.size) throw new TypeError("REPLAY_TRUST_ROOT_REQUIRED"); Object.freeze(this);
  }
  verify(statementBytes: Uint8Array, signature: Uint8Array): VerifiedReplayCapability {
    if (statementBytes.byteLength > 16_384 || signature.byteLength !== 64) throw new TypeError("INVALID_REPLAY_CAPABILITY");
    let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(statementBytes)); } catch { throw new TypeError("INVALID_REPLAY_CAPABILITY"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("INVALID_REPLAY_CAPABILITY");
    const statement = value as ReplayCapabilityStatement;
    const keys = Object.keys(statement).sort(); const expected = ["eventTypes","expiresAt","issuer","replayId","repositoryId","schema","tenantId"].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected) || statement.schema !== "agentics.replay-capability/v1" || !statement.replayId ||
      !statement.tenantId || !statement.repositoryId || !Array.isArray(statement.eventTypes) || !statement.eventTypes.length ||
      statement.eventTypes.some((type) => typeof type !== "string" || !type) || !Number.isFinite(Date.parse(statement.expiresAt))) throw new TypeError("INVALID_REPLAY_CAPABILITY");
    const key = this.#keys.get(statement.issuer); if (!key || canonicalJson(statement) !== new TextDecoder().decode(statementBytes) || !verify(null, statementBytes, key, signature))
      throw new TypeError("UNTRUSTED_REPLAY_CAPABILITY");
    return deepFreeze({ [replayCapabilityBrand]: true, statement }) as VerifiedReplayCapability;
  }
}

export function replayEffectPolicy(mode: "DRY_RUN" | "LIVE", envelope: EvolutionEnvelope, capability?: VerifiedReplayCapability,
  nowMs = Date.now()): ReplayEffectPolicy {
  if (mode === "DRY_RUN") return deepFreeze({ replay: true, replayId: "dry-run", allowExternalEffects: false, allowNormalTopicPublish: false,
    tenantId: envelope.tenantId, repositoryId: envelope.repositoryId });
  if (!capability || capability[replayCapabilityBrand] !== true) throw new TypeError("VERIFIED_REPLAY_CAPABILITY_REQUIRED");
  const scope = capability.statement;
  if (scope.tenantId !== envelope.tenantId || scope.repositoryId !== envelope.repositoryId || !scope.eventTypes.includes(envelope.type)) throw new TypeError("REPLAY_SCOPE_MISMATCH");
  if (Date.parse(scope.expiresAt) <= nowMs) throw new TypeError("REPLAY_CAPABILITY_EXPIRED");
  return deepFreeze({ replay: true, replayId: scope.replayId, allowExternalEffects: true, allowNormalTopicPublish: false,
    tenantId: envelope.tenantId, repositoryId: envelope.repositoryId });
}

export class ReplayTransport {
  constructor(readonly transport: PostgresLocalTransport, readonly topic = "evolution.replay.v1") {}
  async publish(message: TransportMessage, policy: ReplayEffectPolicy): Promise<{ messageId: string }> {
    if (!policy.replay || policy.tenantId !== message.envelope.tenantId || policy.repositoryId !== message.envelope.repositoryId) throw new TypeError("REPLAY_POLICY_SCOPE_MISMATCH");
    const replayMessage = { ...message, attributes: { ...message.attributes, replay: "true", replayId: policy.replayId,
      effectMode: policy.allowExternalEffects ? "LIVE_SCOPED" : "DRY_RUN" } };
    return this.transport.publish(this.topic, replayMessage);
  }
  pull(tenantId: string, limit = 10) { return this.transport.pull(tenantId, this.topic, limit); }
}
