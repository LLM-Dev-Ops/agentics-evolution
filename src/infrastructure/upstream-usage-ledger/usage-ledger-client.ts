import type { LedgerReservation, UsageLedgerPort } from "../../contexts/governance/application/upstream-authority-ports.js";
export class UsageLedgerHttpAdapter implements UsageLedgerPort {
  constructor(private readonly endpoint: URL, private readonly token: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {}
  reserve(input: Parameters<UsageLedgerPort["reserve"]>[0], signal: AbortSignal) { validateText(input.organizationId,"organizationId"); validateAmount(input.amount); validateUuid(input.idempotencyKey); if(!Number.isSafeInteger(input.ttlSeconds)||input.ttlSeconds<1||input.ttlSeconds>86_400)throw new TypeError("LEDGER_TTL_INVALID"); return this.call<LedgerReservation>(`/v1/organizations/${encodeURIComponent(input.organizationId)}/reservations`, "POST", input, signal); }
  consume(input: Parameters<UsageLedgerPort["consume"]>[0], signal: AbortSignal) { validateText(input.reservationId,"reservationId");validateAmount(input.actualAmount);validateUuid(input.idempotencyKey); return this.call<{ entryId: string; amount: string }>(`/v1/reservations/${encodeURIComponent(input.reservationId)}/consume`, "POST", input, signal); }
  cancel(input: Parameters<UsageLedgerPort["cancel"]>[0], signal: AbortSignal) { validateText(input.reservationId,"reservationId"); return this.call<LedgerReservation>(`/v1/reservations/${encodeURIComponent(input.reservationId)}/cancel`, "POST", input, signal); }
  private async call<T>(path: string, method: string, body: object, signal: AbortSignal): Promise<T> {
    const bearer = await this.token(); if (!bearer) throw new Error("USAGE_LEDGER_IDENTITY_UNAVAILABLE");
    const response = await this.fetcher(new URL(path, this.endpoint), { method, signal, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { if(response.status===409)throw new TypeError("USAGE_LEDGER_IDEMPOTENCY_CONFLICT");if(response.status===402||response.status===422)throw new TypeError("USAGE_LEDGER_CEILING_REJECTED");throw new Error("USAGE_LEDGER_UNAVAILABLE"); } return await response.json() as T;
  }
}
function validateAmount(value:string){if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)||Number(value)<=0)throw new TypeError("LEDGER_AMOUNT_INVALID");}
function validateUuid(value:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new TypeError("LEDGER_IDEMPOTENCY_KEY_INVALID");}
function validateText(value:string,name:string){if(!value||value.length>256||/[\u0000-\u001f]/u.test(value))throw new TypeError(`LEDGER_${name.toUpperCase()}_INVALID`);}
