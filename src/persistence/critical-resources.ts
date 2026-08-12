import { PostgresPersistence, withSerializableRetry } from "./postgres.js";

export type CriticalResourceType = "alpha" | "authorization" | "budget" | "champion";
export interface ResourceCommand { readonly tenantId: string; readonly repositoryId: string; readonly resourceType: CriticalResourceType; readonly resourceId: string; readonly expectedVersion: number; }

export class CriticalResourceStore {
  constructor(readonly database: PostgresPersistence) {}
  async initialize(command: Omit<ResourceCommand, "expectedVersion">, remaining: bigint | null, value: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", (client) => client.query(
      `INSERT INTO critical_resources(tenant_id,repository_id,resource_type,resource_id,remaining,value)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [command.tenantId, command.repositoryId, command.resourceType, command.resourceId, remaining?.toString() ?? null, value]).then(() => undefined));
  }
  async spend(command: ResourceCommand, amount: bigint): Promise<{ version: number; remaining: bigint }> {
    if (amount <= 0n || !["alpha", "budget"].includes(command.resourceType)) throw new TypeError("positive alpha/budget spend required");
    return withSerializableRetry(() => this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query<{ version: string; remaining: string }>(`UPDATE critical_resources SET remaining=remaining-$6,version=version+1
        WHERE tenant_id=$1 AND repository_id=$2 AND resource_type=$3 AND resource_id=$4 AND version=$5 AND remaining >= $6
        RETURNING version,remaining`, [command.tenantId, command.repositoryId, command.resourceType, command.resourceId, command.expectedVersion, amount.toString()]);
      const row = result.rows[0]; if (!row) throw Object.assign(new Error("RESOURCE_CONFLICT_OR_INSUFFICIENT"), { code: "40900" });
      return { version: Number(row.version), remaining: BigInt(row.remaining) };
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
  async consumeAuthorization(command: ResourceCommand): Promise<number> {
    if (command.resourceType !== "authorization") throw new TypeError("authorization resource required");
    return withSerializableRetry(() => this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query<{ version: string }>(`UPDATE critical_resources SET consumed=true,version=version+1 WHERE tenant_id=$1 AND repository_id=$2
        AND resource_type='authorization' AND resource_id=$3 AND version=$4 AND consumed=false RETURNING version`,
        [command.tenantId, command.repositoryId, command.resourceId, command.expectedVersion]);
      if (!result.rows[0]) throw Object.assign(new Error("AUTHORIZATION_ALREADY_CONSUMED"), { code: "40900" }); return Number(result.rows[0].version);
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
  async changeChampion(command: ResourceCommand, value: Readonly<Record<string, unknown>>): Promise<number> {
    if (command.resourceType !== "champion") throw new TypeError("champion resource required");
    return withSerializableRetry(() => this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query<{ version: string }>(`UPDATE critical_resources SET value=$5,version=version+1 WHERE tenant_id=$1 AND repository_id=$2
        AND resource_type='champion' AND resource_id=$3 AND version=$4 RETURNING version`,
        [command.tenantId, command.repositoryId, command.resourceId, command.expectedVersion, value]);
      if (!result.rows[0]) throw Object.assign(new Error("CHAMPION_VERSION_CONFLICT"), { code: "40900" }); return Number(result.rows[0].version);
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
}
