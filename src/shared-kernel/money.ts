export type Currency = string & { readonly __currency: unique symbol };
export interface Money { readonly minorUnits: bigint; readonly currency: Currency; }
const CURRENCY = /^[A-Z]{3}$/;
const SUPPORTED_CURRENCIES = new Set(["AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "INR", "JPY", "KRW", "USD"]);
const MAX_MINOR_UNITS = 10n ** 24n;

export function currency(value: string): Currency {
  if (!CURRENCY.test(value) || !SUPPORTED_CURRENCIES.has(value)) throw new TypeError("currency is not in the supported ISO 4217 catalog");
  return value as Currency;
}

export function money(minorUnits: bigint, code: string): Readonly<Money> {
  if (minorUnits < 0n || minorUnits > MAX_MINOR_UNITS) throw new RangeError("money is outside supported minor-unit range");
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
