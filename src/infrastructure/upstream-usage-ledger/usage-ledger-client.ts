import type { LedgerReservation, UsageLedgerPort } from "../../contexts/governance/application/upstream-authority-ports.js";
export class UsageLedgerHttpAdapter implements UsageLedgerPort {
  constructor(private readonly endpoint: URL, private readonly token: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {}
  reserve(input: Parameters<UsageLedgerPort["reserve"]>[0], signal: AbortSignal) { return this.call<LedgerReservation>(`/v1/organizations/${input.organizationId}/reservations`, "POST", input, signal); }
  consume(input: Parameters<UsageLedgerPort["consume"]>[0], signal: AbortSignal) { return this.call<{ entryId: string; amount: string }>(`/v1/reservations/${input.reservationId}/consume`, "POST", input, signal); }
  cancel(input: Parameters<UsageLedgerPort["cancel"]>[0], signal: AbortSignal) { return this.call<LedgerReservation>(`/v1/reservations/${input.reservationId}/cancel`, "POST", input, signal); }
  private async call<T>(path: string, method: string, body: object, signal: AbortSignal): Promise<T> {
    const bearer = await this.token(); if (!bearer) throw new Error("USAGE_LEDGER_IDENTITY_UNAVAILABLE");
    const response = await this.fetcher(new URL(path, this.endpoint), { method, signal, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("USAGE_LEDGER_UNAVAILABLE"); return await response.json() as T;
  }
}
