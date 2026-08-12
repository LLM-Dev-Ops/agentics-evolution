import { PostgresPersistence, withSerializableRetry } from "./postgres.js";
import type pg from "pg";
import type { EvolutionEnvelope } from "../shared-kernel/evolution-envelope.js";

export type CriticalResourceType = "alpha" | "authorization" | "budget" | "champion";
export interface ResourceCommand { readonly tenantId: string; readonly repositoryId: string; readonly resourceType: CriticalResourceType; readonly resourceId: string; readonly expectedVersion: number; }
export interface CriticalAudit { readonly event: EvolutionEnvelope; readonly topic: "evolution.commands.v1" | "evolution.events.v1"; readonly traceparent?: string; }

export class CriticalResourceStore {
  constructor(readonly database: PostgresPersistence) {}
  async initialize(command: Omit<ResourceCommand, "expectedVersion">, remaining: bigint | null, value: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => { await client.query(
      `INSERT INTO critical_resources(tenant_id,repository_id,resource_type,resource_id,remaining,value)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [command.tenantId, command.repositoryId, command.resourceType, command.resourceId, remaining?.toString() ?? null, value]);
      await client.query(`INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES($1,$2,$3,$4,0,$5)
        ON CONFLICT DO NOTHING`, [command.tenantId, command.repositoryId, command.resourceId, `critical:${command.resourceType}`, { remaining: remaining?.toString() ?? null, value }]);
    });
  }
  async spend(command: ResourceCommand, amount: bigint, audit: CriticalAudit): Promise<{ version: number; remaining: bigint }> {
    if (amount <= 0n || !["alpha", "budget"].includes(command.resourceType)) throw new TypeError("positive alpha/budget spend required");
    return withSerializableRetry(() => this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query<{ version: string; remaining: string }>(`UPDATE critical_resources SET remaining=remaining-$6,version=version+1
        WHERE tenant_id=$1 AND repository_id=$2 AND resource_type=$3 AND resource_id=$4 AND version=$5 AND remaining >= $6
        RETURNING version,remaining`, [command.tenantId, command.repositoryId, command.resourceType, command.resourceId, command.expectedVersion, amount.toString()]);
      const row = result.rows[0]; if (!row) throw Object.assign(new Error("RESOURCE_CONFLICT_OR_INSUFFICIENT"), { code: "40900" });
      await appendCriticalAudit(client, command, Number(row.version), { remaining: row.remaining }, audit);
      return { version: Number(row.version), remaining: BigInt(row.remaining) };
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
  async consumeAuthorization(command: ResourceCommand, audit: CriticalAudit): Promise<number> {
    if (command.resourceType !== "authorization") throw new TypeError("authorization resource required");
    return withSerializableRetry(() => this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query<{ version: string }>(`UPDATE critical_resources SET consumed=true,version=version+1 WHERE tenant_id=$1 AND repository_id=$2
        AND resource_type='authorization' AND resource_id=$3 AND version=$4 AND consumed=false RETURNING version`,
        [command.tenantId, command.repositoryId, command.resourceId, command.expectedVersion]);
      if (!result.rows[0]) throw Object.assign(new Error("AUTHORIZATION_ALREADY_CONSUMED"), { code: "40900" });
      await appendCriticalAudit(client, command, Number(result.rows[0].version), { consumed: true }, audit); return Number(result.rows[0].version);
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
  async changeChampion(command: ResourceCommand, value: Readonly<Record<string, unknown>>, audit: CriticalAudit): Promise<number> {
    if (command.resourceType !== "champion") throw new TypeError("champion resource required");
    return withSerializableRetry(() => this.database.tenantTransaction(command.tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query<{ version: string }>(`UPDATE critical_resources SET value=$5,version=version+1 WHERE tenant_id=$1 AND repository_id=$2
        AND resource_type='champion' AND resource_id=$3 AND version=$4 RETURNING version`,
        [command.tenantId, command.repositoryId, command.resourceId, command.expectedVersion, value]);
      if (!result.rows[0]) throw Object.assign(new Error("CHAMPION_VERSION_CONFLICT"), { code: "40900" });
      await appendCriticalAudit(client, command, Number(result.rows[0].version), { value }, audit); return Number(result.rows[0].version);
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
}

async function appendCriticalAudit(client: pg.PoolClient, command: ResourceCommand, version: number, state: Readonly<Record<string, unknown>>, audit: CriticalAudit): Promise<void> {
  const event = audit.event;
  if (event.tenantId !== command.tenantId || event.repositoryId !== command.repositoryId || event.aggregateId !== command.resourceId) throw new TypeError("CRITICAL_AUDIT_SCOPE_MISMATCH");
  const projection = await client.query(`UPDATE aggregates SET version=$4,state=$5,updated_at=transaction_timestamp()
    WHERE tenant_id=$1 AND repository_id=$2 AND aggregate_id=$3 AND version=$6 RETURNING version`,
    [command.tenantId, command.repositoryId, command.resourceId, version, state, command.expectedVersion]);
  if (projection.rowCount !== 1) throw Object.assign(new Error("CRITICAL_PROJECTION_CONFLICT"), { code: "40001" });
  await client.query(`INSERT INTO domain_events(tenant_id,repository_id,aggregate_id,event_id,aggregate_version,event_type,envelope,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [command.tenantId, command.repositoryId, command.resourceId, event.id, version, event.type, event, event.occurredAt]);
  await client.query(`INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope,traceparent)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [command.tenantId, event.id, command.repositoryId, command.resourceId, audit.topic,
    `${command.tenantId}/${command.repositoryId}/${command.resourceId}`, event, audit.traceparent ?? null]);
}
