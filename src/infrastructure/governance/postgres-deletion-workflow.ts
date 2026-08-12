import { withSerializableRetry, type PostgresPersistence } from "../../persistence/postgres.js";
import type { DeletionBoundary, DeletionCategory, DeletionReceiptSigner, DeletionResult, DeletionTombstone, SignedDeletionReceipt } from "../../contexts/governance/application/privacy-boundaries.js";

const categories: readonly DeletionCategory[] = ["DATABASE", "ARTIFACT", "EVENT", "CACHE", "VECTOR", "KEY", "BACKUP_OBLIGATION"];
export class PostgresDeletionWorkflow {
  private readonly adapters: Map<DeletionCategory, DeletionBoundary>;
  constructor(private readonly database: PostgresPersistence, boundaries: readonly DeletionBoundary[], private readonly signer: DeletionReceiptSigner, private readonly now: () => Date = () => new Date()) {
    this.adapters = new Map(boundaries.map((value) => [value.category, value])); for (const category of categories) if (!this.adapters.has(category)) throw new TypeError(`DELETION_BOUNDARY_MISSING:${category}`);
  }
  async request(tombstone: DeletionTombstone): Promise<void> {
    if (tombstone.state !== "ACTIVE") throw new TypeError("ACTIVE_DELETION_TOMBSTONE_REQUIRED");
    await this.database.tenantTransaction(tombstone.tenantId, "SERIALIZABLE", async (client) => {
      const prior = await client.query("SELECT request_id,policy_epoch FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2 FOR UPDATE", [tombstone.tenantId,tombstone.repositoryId]);
      if (prior.rowCount) { if (prior.rows[0].request_id !== tombstone.requestId || Number(prior.rows[0].policy_epoch) !== tombstone.policyEpoch) throw new TypeError("DELETION_TOMBSTONE_CONFLICT"); return; }
      await client.query("INSERT INTO governance_deletion_tombstones(tenant_id,repository_id,request_id,requested_at,policy_epoch,state) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,tombstone.requestedAt,tombstone.policyEpoch]);
      for (const category of categories) await client.query("INSERT INTO governance_deletion_jobs(tenant_id,repository_id,request_id,category) VALUES($1,$2,$3,$4)", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,category]);
    });
  }
  async assertWritesAllowed(tenantId: string, repositoryId: string): Promise<void> {
    const blocked = await this.database.tenantTransaction(tenantId, "READ COMMITTED", (client) => client.query("SELECT 1 FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2", [tenantId,repositoryId]));
    if (blocked.rowCount) throw new TypeError("REPOSITORY_TOMBSTONED");
  }
  async resume(tombstone: DeletionTombstone): Promise<SignedDeletionReceipt> {
    for (const category of categories) {
      const claim = await retry(() => this.database.tenantTransaction(tombstone.tenantId, "SERIALIZABLE", async (client) => {
        const row = await client.query("SELECT state,operation_key FROM governance_deletion_jobs WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3 AND category=$4 FOR UPDATE", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,category]);
        if (!row.rowCount) throw new TypeError("DELETION_JOB_NOT_FOUND"); if (row.rows[0].state === "COMPLETED") return undefined;
        const operationKey = row.rows[0].operation_key ?? `${tombstone.requestId}/${category}`;
        await client.query(`UPDATE governance_deletion_jobs SET state='IN_PROGRESS',operation_key=$5,attempts=attempts+1,updated_at=transaction_timestamp()
          WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3 AND category=$4`, [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,category,operationKey]); return operationKey as string;
      }));
      if (!claim) continue; const adapter = this.adapters.get(category)!; const result = await adapter.delete(tombstone, claim); validateResult(result, category, tombstone, claim);
      if (!await adapter.verify(result)) throw new TypeError("DELETION_ACKNOWLEDGEMENT_UNVERIFIED");
      await retry(() => this.database.tenantTransaction(tombstone.tenantId, "SERIALIZABLE", async (client) => {
        const updated = await client.query(`UPDATE governance_deletion_jobs SET state='COMPLETED',result=$6,acknowledgement_digest=$7,updated_at=transaction_timestamp()
          WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3 AND category=$4 AND operation_key=$5 AND state='IN_PROGRESS'`,
        [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,category,claim,result,result.acknowledgementDigest]); if (!updated.rowCount) {
          const prior = await client.query("SELECT result FROM governance_deletion_jobs WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3 AND category=$4", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,category]);
          if (prior.rows[0]?.result?.acknowledgementDigest !== result.acknowledgementDigest) throw new TypeError("DELETION_ACKNOWLEDGEMENT_CONFLICT"); }
      }));
    }
    return this.complete(tombstone);
  }
  private async complete(tombstone: DeletionTombstone): Promise<SignedDeletionReceipt> {
    return retry(() => this.database.tenantTransaction(tombstone.tenantId, "SERIALIZABLE", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`deletion-receipt/${tombstone.tenantId}/${tombstone.repositoryId}/${tombstone.requestId}`]);
      const prior = await client.query("SELECT payload,key_id,signature FROM governance_deletion_receipts WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId]);
      if (prior.rowCount) return Object.freeze({ payload: prior.rows[0].payload, keyId: prior.rows[0].key_id, signature: prior.rows[0].signature }) as SignedDeletionReceipt;
      const rows = await client.query("SELECT category,result FROM governance_deletion_jobs WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3 ORDER BY category", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId]);
      if (rows.rowCount !== categories.length || rows.rows.some(({ result }) => !result)) throw new TypeError("DELETION_INCOMPLETE");
      const payload = Object.freeze({ schema: "agentics.deletion-receipt/v1" as const, tombstone, completedAt: this.now().toISOString(), results: Object.freeze(rows.rows.map(({ result }) => result as DeletionResult)) }); const receipt = await this.signer.sign(payload);
      await client.query("INSERT INTO governance_deletion_receipts(tenant_id,repository_id,request_id,payload,key_id,signature) VALUES($1,$2,$3,$4,$5,$6)", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId,receipt.payload,receipt.keyId,receipt.signature]);
      await client.query("UPDATE governance_deletion_tombstones SET state='COMPLETED',completed_at=transaction_timestamp() WHERE tenant_id=$1 AND repository_id=$2 AND request_id=$3", [tombstone.tenantId,tombstone.repositoryId,tombstone.requestId]);
      return receipt;
    }));
  }
}
function retry<T>(operation: () => Promise<T>): Promise<T> { return withSerializableRetry(() => operation(), { maxAttempts: 20, baseDelayMs: 2, deadlineMs: Date.now() + 20_000 }); }
function validateResult(value: DeletionResult, category: DeletionCategory, tombstone: DeletionTombstone, operationKey: string): void { if (value.category !== category || value.operationKey !== operationKey || value.tenantId !== tombstone.tenantId || value.repositoryId !== tombstone.repositoryId || value.requestId !== tombstone.requestId || ![value.removed,value.retained,value.held].every((item) => Number.isSafeInteger(item) && item >= 0) || !/^[a-f0-9]{64}$/.test(value.digest) || !/^[a-f0-9]{64}$/.test(value.acknowledgementDigest)) throw new TypeError("DELETION_ACKNOWLEDGEMENT_INVALID"); }
