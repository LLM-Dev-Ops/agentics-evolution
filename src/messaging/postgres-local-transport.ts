import { newEventId } from "../shared-kernel/uuid-v7.js";
import type { EventTransport, PublishReceipt, TransportMessage } from "./transport.js";
import { validateTransportMessage } from "./transport.js";
import type { PostgresPersistence } from "../persistence/postgres.js";

export class PostgresLocalTransport implements EventTransport {
  constructor(readonly database: PostgresPersistence) {}
  async publish(topic: string, message: TransportMessage): Promise<PublishReceipt> {
    validateTransportMessage(message);
    const messageId = newEventId();
    await this.database.tenantTransaction(message.envelope.tenantId, "READ COMMITTED", (client) => client.query(
      `INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [message.envelope.tenantId, `local:${topic}`, message.envelope.id, message.envelope.evidence[0]?.sha256 ?? "0".repeat(64)]).then(() => undefined));
    return { messageId };
  }
}
