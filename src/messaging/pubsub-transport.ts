import { PubSub, type Message, type Subscription } from "@google-cloud/pubsub";
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

export interface PubSubDelivery {
  readonly messageId: string;
  readonly message: TransportMessage;
  ack(): void;
  nack(): void;
}

export class GooglePubSubConsumer {
  constructor(readonly client: PubSub, readonly decode: (bytes: Uint8Array, attributes: Readonly<Record<string, string>>, orderingKey: string) => TransportMessage) {}
  async receiveOne(subscriptionName: string, timeoutMs = 10_000): Promise<PubSubDelivery> {
    const subscription = this.client.subscription(subscriptionName, { flowControl: { maxMessages: 1 } });
    return new Promise<PubSubDelivery>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("PUBSUB_RECEIVE_TIMEOUT")); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); subscription.removeListener("message", onMessage); subscription.removeListener("error", onError); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onMessage = (raw: Message) => {
        try {
          const message = this.decode(raw.data, raw.attributes, raw.orderingKey ?? ""); validateTransportMessage(message); cleanup();
          resolve({ messageId: raw.id, message, ack: () => raw.ack(), nack: () => raw.nack() });
        } catch (error) { raw.nack(); cleanup(); reject(error); }
      };
      subscription.once("error", onError); subscription.once("message", onMessage);
    }).finally(() => closeSubscription(subscription));
  }
}

function closeSubscription(subscription: Subscription): void {
  subscription.removeAllListeners("message"); subscription.removeAllListeners("error");
}
