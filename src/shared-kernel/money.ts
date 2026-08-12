export type Currency = string & { readonly __currency: unique symbol };
export interface Money { readonly minorUnits: bigint; readonly currency: Currency; }
const CURRENCY = /^[A-Z]{3}$/;

export function currency(value: string): Currency {
  if (!CURRENCY.test(value)) throw new TypeError("currency must be a three-letter uppercase ISO code");
  return value as Currency;
}

export function money(minorUnits: bigint, code: string): Readonly<Money> {
  if (minorUnits < 0n) throw new RangeError("money cannot be negative");
  return Object.freeze({ minorUnits, currency: currency(code) });
}

export function addMoney(left: Money, right: Money): Readonly<Money> {
  if (left.currency !== right.currency) throw new TypeError("cannot add different currencies");
  return money(left.minorUnits + right.minorUnits, left.currency);
}

export const moneyToWire = (value: Money) => Object.freeze({ minorUnits: value.minorUnits.toString(10), currency: value.currency });
export const moneyFromWire = (value: { minorUnits: string; currency: string }): Readonly<Money> => {
  if (!/^(0|[1-9]\d*)$/.test(value.minorUnits)) throw new TypeError("minorUnits must be a canonical non-negative integer string");
  return money(BigInt(value.minorUnits), value.currency);
};
