import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";

export interface DeletionTombstone { readonly schema: "agentics.deletion-tombstone/v1"; readonly tenantId: TenantId; readonly repositoryId: RepositoryId;
  readonly requestId: string; readonly requestedAt: string; readonly policyEpoch: number; readonly state: "ACTIVE" | "COMPLETED"; }
export function deletionTombstone(value: Omit<DeletionTombstone, "schema" | "state">): DeletionTombstone {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value.requestId) || !Number.isSafeInteger(value.policyEpoch) || value.policyEpoch < 1 || !Number.isFinite(Date.parse(value.requestedAt))) throw new TypeError("INVALID_DELETION_TOMBSTONE");
  return Object.freeze({ schema: "agentics.deletion-tombstone/v1", ...value, state: "ACTIVE" });
}
export type DeletionCategory = "DATABASE" | "ARTIFACT" | "EVENT" | "CACHE" | "VECTOR" | "KEY" | "BACKUP_OBLIGATION";
export interface DeletionResult { readonly category: DeletionCategory; readonly operationKey: string; readonly tenantId: TenantId; readonly repositoryId: RepositoryId;
  readonly requestId: string; readonly removed: number; readonly retained: number; readonly held: number; readonly digest: string; readonly acknowledgementDigest: string; }
export interface DeletionBoundary { readonly category: DeletionCategory; delete(tombstone: DeletionTombstone, operationKey: string): Promise<DeletionResult>; verify(result: DeletionResult): Promise<boolean>; }
export interface DeletionReceiptPayload { readonly schema: "agentics.deletion-receipt/v1"; readonly tombstone: DeletionTombstone; readonly completedAt: string; readonly results: readonly DeletionResult[]; }
export interface SignedDeletionReceipt { readonly payload: DeletionReceiptPayload; readonly keyId: string; readonly signature: string; }
export interface DeletionReceiptSigner { sign(payload: DeletionReceiptPayload): Promise<SignedDeletionReceipt>; }
export class DeletionCoordinator {
  constructor(private readonly boundaries: readonly DeletionBoundary[], private readonly signer: DeletionReceiptSigner, private readonly now: () => Date = () => new Date()) {}
  async execute(tombstone: DeletionTombstone): Promise<SignedDeletionReceipt> {
    if (tombstone.state !== "ACTIVE") throw new TypeError("ACTIVE_DELETION_TOMBSTONE_REQUIRED"); const categories = new Set(this.boundaries.map(({ category }) => category));
    for (const required of ["DATABASE", "ARTIFACT", "EVENT", "CACHE", "VECTOR", "KEY", "BACKUP_OBLIGATION"] as const) if (!categories.has(required)) throw new TypeError(`DELETION_BOUNDARY_MISSING:${required}`);
    const results: DeletionResult[] = []; for (const boundary of this.boundaries) { const operationKey = `${tombstone.requestId}/${boundary.category}`; const result = await boundary.delete(tombstone, operationKey);
      if (!await boundary.verify(result)) throw new TypeError("DELETION_ACKNOWLEDGEMENT_UNVERIFIED"); results.push(result); }
    return this.signer.sign(Object.freeze({ schema: "agentics.deletion-receipt/v1", tombstone, completedAt: this.now().toISOString(), results: Object.freeze(results) }));
  }
}
