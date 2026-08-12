import type pg from "pg";
import { randomUUID } from "node:crypto";
import type { EvolutionEnvelope } from "../shared-kernel/evolution-envelope.js";
import { canonicalJson } from "../shared-kernel/immutable.js";
import { digestBytes } from "../shared-kernel/digest.js";
import type { EventTransport, TransportMessage } from "../messaging/transport.js";
import { PostgresPersistence } from "./postgres.js";

export interface OutboxLease { readonly tenantId: string; readonly eventId: string; readonly topic: string; readonly orderingKey: string; readonly envelope: EvolutionEnvelope; readonly traceparent?: string; readonly attempts: number; readonly leaseToken: string; }

export class OutboxRelay {
  constructor(readonly database: PostgresPersistence, readonly transport: EventTransport, readonly maxAttempts = 8) {}
  async claim(tenantId: string, limit = 50): Promise<readonly OutboxLease[]> {
    return this.database.tenantTransaction(tenantId, "READ COMMITTED", async (client) => {
      const token = randomUUID();
      const rows = await client.query(`SELECT tenant_id,event_id,topic,ordering_key,envelope,traceparent,attempts
        FROM outbox WHERE tenant_id=$1 AND published_at IS NULL AND next_attempt_at<=transaction_timestamp() AND expires_at>transaction_timestamp()
        AND (lease_expires_at IS NULL OR lease_expires_at<=transaction_timestamp())
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2`, [tenantId, limit]);
      await client.query(`UPDATE outbox SET attempts=attempts+1,lease_token=$3,lease_owner='relay',lease_expires_at=transaction_timestamp()+interval '30 seconds'
        WHERE tenant_id=$1 AND event_id=ANY($2::uuid[])`, [tenantId, rows.rows.map((row) => row.event_id), token]);
      return rows.rows.map((row) => ({ tenantId: row.tenant_id, eventId: row.event_id, topic: row.topic, orderingKey: row.ordering_key,
        envelope: row.envelope, traceparent: row.traceparent ?? undefined, attempts: row.attempts + 1, leaseToken: token }));
    });
  }
  async publish(lease: OutboxLease): Promise<void> {
    const message: TransportMessage = { envelope: lease.envelope, orderingKey: lease.orderingKey,
      attributes: { eventId: lease.eventId, correlationId: lease.envelope.correlationId, causationId: lease.envelope.causationId,
        ...(lease.traceparent ? { traceparent: lease.traceparent } : {}) } };
    try {
      const receipt = await this.transport.publish(lease.topic, message);
      await this.database.tenantTransaction(lease.tenantId, "READ COMMITTED", (client) => client.query(
        "UPDATE outbox SET published_at=transaction_timestamp(),broker_message_id=$3,lease_token=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND event_id=$2 AND published_at IS NULL AND lease_token=$4",
        [lease.tenantId, lease.eventId, receipt.messageId, lease.leaseToken]).then((result) => { if (result.rowCount !== 1) throw new Error("STALE_OUTBOX_LEASE"); }));
    } catch (error) {
      if (lease.attempts >= this.maxAttempts) await this.deadLetter(lease, error);
      throw error;
    }
  }
  async deadLetter(lease: OutboxLease, error: unknown): Promise<void> {
    await this.database.tenantTransaction(lease.tenantId, "READ COMMITTED", async (client: pg.PoolClient) => {
      await client.query(`INSERT INTO dead_letters(tenant_id,event_id,consumer,reason_code,reason_detail,attempts,first_seen_at,traceparent,envelope)
        VALUES($1,$2,'outbox-relay','PUBLISH_EXHAUSTED',$3,$4,transaction_timestamp(),$5,$6) ON CONFLICT DO NOTHING`,
        [lease.tenantId, lease.eventId, String(error).slice(0, 512), lease.attempts, lease.traceparent ?? null, lease.envelope]);
      await client.query("UPDATE outbox SET published_at='infinity'::timestamptz WHERE tenant_id=$1 AND event_id=$2", [lease.tenantId, lease.eventId]);
    });
  }
  async drain(tenantId: string): Promise<number> {
    const leases = await this.claim(tenantId); for (const lease of leases) await this.publish(lease); return leases.length;
  }
}

export async function consumeOnce<T>(database: PostgresPersistence, tenantId: string, consumer: string, event: EvolutionEnvelope,
  effect: (client: pg.PoolClient) => Promise<T>): Promise<{ duplicate: boolean; result?: T }> {
  if (event.tenantId !== tenantId) throw new TypeError("EVENT_TENANT_MISMATCH");
  const envelopeDigest = digestBytes(new TextEncoder().encode(canonicalJson(event)));
  return database.tenantTransaction(tenantId, "SERIALIZABLE", async (client) => {
    const inserted = await client.query("INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id",
      [tenantId, consumer, event.id, envelopeDigest]);
    if (!inserted.rowCount) {
      const prior = await client.query("SELECT payload_digest FROM inbox WHERE tenant_id=$1 AND consumer=$2 AND event_id=$3", [tenantId, consumer, event.id]);
      if (prior.rows[0]?.payload_digest !== envelopeDigest) throw new TypeError("INBOX_EVENT_DIGEST_CONFLICT");
      return { duplicate: true };
    }
    return { duplicate: false, result: await effect(client) };
  });
}
