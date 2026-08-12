declare const instantBrand: unique symbol;
export type UtcInstant = string & { readonly [instantBrand]: "UtcInstant" };
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function utcInstant(value: string): UtcInstant {
  if (!UTC_MILLIS.test(value)) throw new TypeError("instant must be canonical RFC3339 UTC with millisecond precision");
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) throw new TypeError("invalid UTC instant");
  return value as UtcInstant;
}

export interface Clock { now(): UtcInstant; }
export const systemClock: Clock = { now: () => utcInstant(new Date().toISOString()) };
