import type { CapabilityEnvelope } from "./capability.js";
import { isEnvelopeSubset, normalizeEnvelope } from "./capability.js";
export interface CapabilityDelegation { readonly id: string; readonly parentId: string | null; readonly envelope: CapabilityEnvelope; readonly revoked: boolean; readonly version: number; }
export function createDelegation(id: string, envelope: CapabilityEnvelope, parent?: CapabilityDelegation): CapabilityDelegation {
  if (!id || parent?.revoked || (parent && (!isEnvelopeSubset(envelope, parent.envelope) || envelope.depth >= parent.envelope.depth))) throw new TypeError("CAPABILITY_DELEGATION_EXPANSION");
  return Object.freeze({ id, parentId: parent?.id ?? null, envelope: normalizeEnvelope(envelope), revoked: false, version: 0 });
}
export function revokeDelegation(value: CapabilityDelegation): CapabilityDelegation { if (value.revoked) throw new TypeError("CAPABILITY_ALREADY_REVOKED"); return Object.freeze({ ...value, revoked: true, version: value.version + 1 }); }
