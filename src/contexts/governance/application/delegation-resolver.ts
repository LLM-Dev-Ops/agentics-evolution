import { isEnvelopeSubset, type CapabilityEnvelope } from "../domain/capability.js";

export interface StoredDelegation { readonly id: string; readonly parentId: string | null; readonly envelope: CapabilityEnvelope; readonly revoked: boolean; readonly policyEpoch: string; }
export interface DelegationStore { load(tenantId: string, delegationId: string): Promise<StoredDelegation | null>; }

export class DelegationChainResolver {
  constructor(private readonly store: DelegationStore, private readonly maximumDepth = 32) { if (maximumDepth < 1) throw new TypeError("INVALID_DELEGATION_DEPTH"); }
  async resolve(tenantId: string, delegationId: string, policyEpoch: string, now = new Date().toISOString()): Promise<readonly StoredDelegation[]> {
    const chain: StoredDelegation[] = []; const seen = new Set<string>(); let id: string | null = delegationId;
    while (id) {
      if (seen.has(id) || chain.length >= this.maximumDepth) throw new TypeError("DELEGATION_CHAIN_INVALID"); seen.add(id);
      const current = await this.store.load(tenantId, id); if (!current || current.envelope.tenantId !== tenantId) throw new TypeError("DELEGATION_NOT_FOUND");
      if (current.revoked || current.policyEpoch !== policyEpoch || Date.parse(current.envelope.expiresAt) <= Date.parse(now)) throw new TypeError("DELEGATION_ANCESTOR_INVALID");
      const child = chain.at(-1); if (child && (!isEnvelopeSubset(child.envelope, current.envelope) || child.envelope.depth >= current.envelope.depth)) throw new TypeError("DELEGATION_CHAIN_EXPANSION");
      chain.push(current); id = current.parentId;
    }
    return Object.freeze(chain);
  }
}
