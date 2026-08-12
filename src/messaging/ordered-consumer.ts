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
      const tombstone = await client.query("SELECT 1 FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2", [event.tenantId,event.repositoryId]);
      if (tombstone.rowCount) throw new TypeError("REPOSITORY_TOMBSTONED");
      const digest = digestBytes(new TextEncoder().encode(canonicalJson(event)));
      const prior = await client.query("SELECT payload_digest FROM inbox WHERE tenant_id=$1 AND consumer=$2 AND event_id=$3", [event.tenantId, this.consumer, event.id]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_digest !== digest) throw new TypeError("ORDERED_EVENT_DIGEST_CONFLICT");
        return { kind: "DUPLICATE" };
      }
      await client.query(`INSERT INTO consumer_progress(tenant_id,consumer,repository_id,aggregate_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [event.tenantId, this.consumer, event.repositoryId, event.aggregateId]);
      const current = await client.query(`SELECT aggregate_version,last_event_id,last_payload_digest FROM consumer_progress
        WHERE tenant_id=$1 AND consumer=$2 AND repository_id=$3 AND aggregate_id=$4 FOR UPDATE`, [event.tenantId, this.consumer, event.repositoryId, event.aggregateId]);
      const cursor = current.rows[0]; const expectedVersion = Number(cursor.aggregate_version) + 1;
      if (aggregateVersion > expectedVersion) return { kind: "GAP_DEFERRED", expectedVersion, receivedVersion: aggregateVersion };
      if (aggregateVersion < expectedVersion) throw new TypeError("ORDERED_EVENT_CONFLICT");
      const result = await effect(client);
      await client.query("INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest) VALUES($1,$2,$3,$4)", [event.tenantId, this.consumer, event.id, digest]);
      await client.query(`UPDATE consumer_progress SET aggregate_version=$5,last_event_id=$6,last_payload_digest=$7,updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND consumer=$2 AND repository_id=$3 AND aggregate_id=$4`, [event.tenantId, this.consumer, event.repositoryId, event.aggregateId, aggregateVersion, event.id, digest]);
      return { kind: "APPLIED", result };
    });
  }
}
