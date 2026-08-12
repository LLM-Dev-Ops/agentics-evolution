import { PubSub } from "@google-cloud/pubsub";
import type { EventTransport, PublishReceipt, TransportMessage } from "./transport.js";
import { validateTransportMessage } from "./transport.js";

export class GooglePubSubTransport implements EventTransport {
  constructor(readonly client: PubSub) {}
  async publish(topic: string, message: TransportMessage): Promise<PublishReceipt> {
    if (!["evolution.commands.v1", "evolution.events.v1", "evolution.deadletter.v1"].includes(topic)) throw new TypeError("INVALID_TOPIC");
    const data = validateTransportMessage(message);
    const messageId = await this.client.topic(topic, { messageOrdering: true }).publishMessage({ data: Buffer.from(data), orderingKey: message.orderingKey, attributes: { ...message.attributes } });
    return { messageId };
  }
}
