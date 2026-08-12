import type { EvolutionEnvelope } from "../shared-kernel/evolution-envelope.js";
import { encodeEnvelope } from "../shared-kernel/evolution-envelope.js";

export const MAX_ENVELOPE_BYTES = 262_144;
export interface TransportMessage { readonly envelope: EvolutionEnvelope; readonly orderingKey: string; readonly attributes: Readonly<Record<string, string>>; }
export interface PublishReceipt { readonly messageId: string; }
export interface EventTransport { publish(topic: string, message: TransportMessage): Promise<PublishReceipt>; }
export interface TransportDelivery { readonly messageId: string; readonly message: TransportMessage; ack(): Promise<void>; nack(): Promise<void> | void; }
export interface DeliverySource { receiveOne(channel: string, timeoutMs?: number): Promise<TransportDelivery>; }

export function validateTransportMessage(message: TransportMessage): Uint8Array {
  const bytes = encodeEnvelope(message.envelope);
  if (bytes.byteLength > MAX_ENVELOPE_BYTES) throw new TypeError("PAYLOAD_TOO_LARGE");
  const expected = `${message.envelope.tenantId}/${message.envelope.repositoryId}/${message.envelope.aggregateId}`;
  if (message.orderingKey !== expected) throw new TypeError("INVALID_ORDERING_KEY");
  if (message.attributes.correlationId !== message.envelope.correlationId || message.attributes.causationId !== message.envelope.causationId)
    throw new TypeError("INVALID_TRACE_BINDING");
  if (message.attributes.traceparent && !/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/.test(message.attributes.traceparent)) throw new TypeError("INVALID_TRACEPARENT");
  return bytes;
}
