import { newEventId } from "../shared-kernel/uuid-v7.js";
import type { DeliverySource, EventTransport, PublishReceipt, TransportDelivery, TransportMessage } from "./transport.js";
import { validateTransportMessage } from "./transport.js";
import type { PostgresPersistence } from "../persistence/postgres.js";

export class PostgresLocalTransport implements EventTransport {
  constructor(readonly database: PostgresPersistence) {}
  async publish(topic: string, message: TransportMessage): Promise<PublishReceipt> {
    validateTransportMessage(message);
    if (!["evolution.commands.v1", "evolution.events.v1", "evolution.deadletter.v1", "evolution.replay.v1"].includes(topic)) throw new TypeError("INVALID_TOPIC");
    const messageId = newEventId();
    const result = await this.database.tenantTransaction(message.envelope.tenantId, "READ COMMITTED", async (client) => {
      const tombstone = await client.query("SELECT 1 FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2", [message.envelope.tenantId,message.envelope.repositoryId]);
      if (tombstone.rowCount) throw new TypeError("REPOSITORY_TOMBSTONED");
      return client.query(
      `INSERT INTO local_transport_messages(tenant_id,message_id,event_id,topic,ordering_key,envelope,attributes)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,event_id,topic) DO UPDATE SET event_id=EXCLUDED.event_id RETURNING message_id`,
      [message.envelope.tenantId, messageId, message.envelope.id, topic, message.orderingKey, message.envelope, message.attributes]);
    });
    return { messageId: result.rows[0].message_id };
  }
  async pull(tenantId: string, topic: string, limit = 10): Promise<readonly { messageId: string; message: TransportMessage; leaseToken: string }[]> {
    return this.database.tenantTransaction(tenantId, "READ COMMITTED", async (client) => {
      const leaseToken = newEventId();
      const rows = await client.query(`SELECT message_id,envelope,ordering_key,attributes FROM local_transport_messages
        WHERE tenant_id=$1 AND topic=$2 AND acked_at IS NULL AND available_at<=transaction_timestamp()
        AND (lease_expires_at IS NULL OR lease_expires_at<=transaction_timestamp())
        ORDER BY ordering_key,created_at FOR UPDATE SKIP LOCKED LIMIT $3`, [tenantId, topic, limit]);
      await client.query(`UPDATE local_transport_messages SET delivery_count=delivery_count+1,lease_token=$3,lease_expires_at=transaction_timestamp()+interval '10 seconds'
        WHERE tenant_id=$1 AND message_id=ANY($2::uuid[])`, [tenantId, rows.rows.map((row) => row.message_id), leaseToken]);
      return rows.rows.map((row) => ({ messageId: row.message_id, leaseToken, message: { envelope: row.envelope, orderingKey: row.ordering_key, attributes: row.attributes } }));
    });
  }
  async ack(tenantId: string, messageId: string, leaseToken: string): Promise<void> {
    await this.database.tenantTransaction(tenantId, "READ COMMITTED", (client) => client.query(
      "UPDATE local_transport_messages SET acked_at=transaction_timestamp() WHERE tenant_id=$1 AND message_id=$2 AND lease_token=$3 AND acked_at IS NULL",
      [tenantId, messageId, leaseToken]).then((result) => { if (result.rowCount !== 1) throw new Error("STALE_TRANSPORT_LEASE"); }));
  }
  async nack(tenantId: string, messageId: string, leaseToken: string): Promise<void> {
    await this.database.tenantTransaction(tenantId, "READ COMMITTED", (client) => client.query(
      "UPDATE local_transport_messages SET lease_token=NULL,lease_expires_at=NULL,available_at=transaction_timestamp() WHERE tenant_id=$1 AND message_id=$2 AND lease_token=$3 AND acked_at IS NULL",
      [tenantId, messageId, leaseToken]).then(() => undefined));
  }
  async defer(tenantId: string, messageId: string, leaseToken: string, delayMs: number): Promise<void> {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 86_400_000) throw new TypeError("INVALID_DEFER_DELAY");
    await this.database.tenantTransaction(tenantId, "READ COMMITTED", (client) => client.query(
      `UPDATE local_transport_messages SET lease_token=NULL,lease_expires_at=NULL,
       available_at=transaction_timestamp()+($4::text||' milliseconds')::interval WHERE tenant_id=$1 AND message_id=$2 AND lease_token=$3 AND acked_at IS NULL`,
      [tenantId, messageId, leaseToken, delayMs]).then((result) => { if (result.rowCount !== 1) throw new Error("STALE_TRANSPORT_LEASE"); }));
  }
  async delay(tenantId: string, messageId: string, availableAt: Date): Promise<void> {
    if (!Number.isFinite(availableAt.getTime())) throw new TypeError("INVALID_AVAILABLE_AT");
    await this.database.tenantTransaction(tenantId, "READ COMMITTED", (client) => client.query(
      "UPDATE local_transport_messages SET available_at=$3,lease_token=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND message_id=$2 AND acked_at IS NULL",
      [tenantId, messageId, availableAt]).then((result) => { if (result.rowCount !== 1) throw new Error("MESSAGE_NOT_FOUND"); }));
  }
}

export class PostgresLocalConsumer implements DeliverySource {
  constructor(readonly transport: PostgresLocalTransport, readonly tenantId: string) {}
  async receiveOne(channel: string, timeoutMs = 10_000): Promise<TransportDelivery> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = (await this.transport.pull(this.tenantId, channel, 1))[0];
      if (row) return { messageId: row.messageId, message: row.message,
        ack: () => this.transport.ack(this.tenantId, row.messageId, row.leaseToken), nack: () => this.transport.nack(this.tenantId, row.messageId, row.leaseToken) };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("LOCAL_RECEIVE_TIMEOUT");
  }
}
