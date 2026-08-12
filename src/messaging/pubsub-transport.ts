import { PubSub, type Message } from "@google-cloud/pubsub";
import { createHash } from "node:crypto";
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
  ack(): Promise<void>;
  nack(): void;
}

export interface PoisonMessageRecord { readonly messageId: string; readonly subscription: string; readonly reason: string;
  readonly payloadSha256: string; readonly attributes: Readonly<Record<string, string>>; readonly orderingKey: string; }
export interface PoisonMessageSink { record(record: PoisonMessageRecord): Promise<void>; }

export class GooglePubSubPoisonSink implements PoisonMessageSink {
  constructor(readonly client: PubSub, readonly topic = "evolution.deadletter.v1") {}
  async record(record: PoisonMessageRecord): Promise<void> {
    await this.client.topic(this.topic).publishMessage({ data: Buffer.from(JSON.stringify(record)),
      orderingKey: record.orderingKey, attributes: { reason: record.reason, originalMessageId: record.messageId, ...record.attributes } });
  }
}

export class GooglePubSubConsumer {
  constructor(readonly client: PubSub, readonly decode: (bytes: Uint8Array, attributes: Readonly<Record<string, string>>, orderingKey: string) => TransportMessage,
    readonly poisonSink: PoisonMessageSink) {}
  async receiveOne(subscriptionName: string, timeoutMs = 10_000): Promise<PubSubDelivery> {
    const subscription = this.client.subscription(subscriptionName, { flowControl: { maxMessages: 1 } });
    return new Promise<PubSubDelivery>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("PUBSUB_RECEIVE_TIMEOUT")); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); subscription.removeListener("message", onMessage); subscription.removeListener("error", onError); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onMessage = async (raw: Message) => {
        try {
          const message = this.decode(raw.data, raw.attributes, raw.orderingKey ?? ""); validateTransportMessage(message); cleanup();
          resolve({ messageId: raw.id, message, ack: async () => { await raw.ackWithResponse(); }, nack: () => raw.nack() });
        } catch (error) {
          try {
            await this.poisonSink.record({ messageId: raw.id, subscription: subscriptionName, reason: normalizePoisonReason(error),
              payloadSha256: createHash("sha256").update(raw.data).digest("hex"), attributes: filterAttributes(raw.attributes), orderingKey: raw.orderingKey ?? "" });
            raw.ack(); cleanup(); reject(Object.assign(new Error("PUBSUB_POISON_DEAD_LETTERED"), { cause: error }));
          } catch (sinkError) { raw.nack(); cleanup(); reject(Object.assign(new Error("PUBSUB_POISON_SINK_FAILED"), { cause: sinkError })); }
        }
      };
      subscription.once("error", onError); subscription.once("message", onMessage);
    }).finally(async () => { subscription.removeAllListeners("message"); subscription.removeAllListeners("error"); await subscription.close(); });
  }
}

const SAFE_ATTRIBUTES = new Set(["eventId", "correlationId", "causationId", "traceparent", "tracestate", "schemaVersion"]);
function filterAttributes(attributes: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => SAFE_ATTRIBUTES.has(key)).map(([key, value]) => [key, value.slice(0, 512)]));
}
function normalizePoisonReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/schema|version/i.test(message)) return "UNKNOWN_CRITICAL_SCHEMA";
  if (/PAYLOAD_TOO_LARGE/.test(message)) return "PAYLOAD_TOO_LARGE";
  if (/trace/i.test(message)) return "INVALID_TRACE_BINDING";
  return "MALFORMED_ENVELOPE";
}
