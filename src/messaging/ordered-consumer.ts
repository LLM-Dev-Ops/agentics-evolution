import type pg from "pg";
import type { EvolutionEnvelope } from "../shared-kernel/evolution-envelope.js";
import type { PostgresPersistence } from "../persistence/postgres.js";
import { canonicalJson } from "../shared-kernel/immutable.js";
import { digestBytes } from "../shared-kernel/digest.js";

export type OrderedApplyResult<T> = { readonly kind: "APPLIED"; readonly result: T } | { readonly kind: "DUPLICATE" } |
  { readonly kind: "GAP_DEFERRED"; readonly expectedVersion: number; readonly receivedVersion: number };

export class OrderedEnvelopeConsumer {
  constructor(readonly database: PostgresPersistence, readonly consumer: string) {}
  async apply<T>(event: EvolutionEnvelope, aggregateVersion: number, effect: (client: pg.PoolClient) => Promise<T>): Promise<OrderedApplyResult<T>> {
    if (!Number.isSafeInteger(aggregateVersion) || aggregateVersion < 1) throw new TypeError("INVALID_AGGREGATE_VERSION");
    return this.database.tenantTransaction(event.tenantId, "SERIALIZABLE", async (client) => {
      const prior = await client.query("SELECT payload_digest FROM inbox WHERE tenant_id=$1 AND consumer=$2 AND event_id=$3", [event.tenantId, this.consumer, event.id]);
      if (prior.rowCount) return { kind: "DUPLICATE" };
      const current = await client.query("SELECT COALESCE(max(aggregate_version),0)::bigint AS version FROM domain_events WHERE tenant_id=$1 AND repository_id=$2 AND aggregate_id=$3",
        [event.tenantId, event.repositoryId, event.aggregateId]);
      const expectedVersion = Number(current.rows[0].version) + 1;
      if (aggregateVersion > expectedVersion) return { kind: "GAP_DEFERRED", expectedVersion, receivedVersion: aggregateVersion };
      if (aggregateVersion < expectedVersion) return { kind: "DUPLICATE" };
      const result = await effect(client);
      const digest = digestBytes(new TextEncoder().encode(canonicalJson(event)));
      await client.query("INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest) VALUES($1,$2,$3,$4)", [event.tenantId, this.consumer, event.id, digest]);
      return { kind: "APPLIED", result };
    });
  }
}
