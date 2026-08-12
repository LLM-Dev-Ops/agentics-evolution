import { parse, stringify, v7, validate, version } from "uuid";

declare const uuidBrand: unique symbol;
type UuidV7<K extends string> = string & { readonly [uuidBrand]: K };
export type EventId = UuidV7<"EventId">;
export type CorrelationId = UuidV7<"CorrelationId">;
export type CausationId = UuidV7<"CausationId">;
export type IdempotencyKey = UuidV7<"IdempotencyKey">;

function branded<K extends string>(value: string, kind: K): UuidV7<K> {
  if (!validate(value) || version(value) !== 7 || stringify(parse(value)) !== value.toLowerCase()) {
    throw new TypeError(`${kind} must be a canonical RFC 9562 UUIDv7`);
  }
  return value as UuidV7<K>;
}

export const eventId = (value: string): EventId => branded(value, "EventId");
export const correlationId = (value: string): CorrelationId => branded(value, "CorrelationId");
export const causationId = (value: string): CausationId => branded(value, "CausationId");
export const idempotencyKey = (value: string): IdempotencyKey => branded(value, "IdempotencyKey");
export const newEventId = (): EventId => eventId(v7());
export const newCorrelationId = (): CorrelationId => correlationId(v7());
export const newCausationId = (): CausationId => causationId(v7());
export const newIdempotencyKey = (): IdempotencyKey => idempotencyKey(v7());
