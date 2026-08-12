import { randomUUID } from "node:crypto";
import type { BudgetAuthorityPort, BudgetReservationRequest } from "../../contexts/governance/application/budget-authority.js";
import type { LedgerReservation, UsageLedgerPort } from "../../contexts/governance/application/upstream-authority-ports.js";
import type { PostgresPersistence } from "../../persistence/postgres.js";
import { digestBytes } from "../../shared-kernel/digest.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";
export class PostgresBudgetAuthority implements BudgetAuthorityPort {
  constructor(private readonly database: PostgresPersistence, private readonly ledger: UsageLedgerPort) {}
  async reserve(input: BudgetReservationRequest, signal: AbortSignal): Promise<LedgerReservation> {
    const digest = digestBytes(new TextEncoder().encode(canonicalJson(input)));
    const existing = await this.database.tenantTransaction(input.tenantId, "SERIALIZABLE", async client => { const row = (await client.query("SELECT request_digest,response,status FROM budget_reservation_sagas WHERE tenant_id=$1 AND repository_id=$2 AND idempotency_key=$3", [input.tenantId,input.repositoryId,input.idempotencyKey])).rows[0]; if (row && row.request_digest !== digest) throw new TypeError("BUDGET_IDEMPOTENCY_CONFLICT"); return row; });
    if (existing?.status === "RESERVED") return existing.response as LedgerReservation;
    const reservation = await this.ledger.reserve(input, signal);
    return this.database.tenantTransaction(input.tenantId, "SERIALIZABLE", async client => {
      const inserted = await client.query(`INSERT INTO budget_reservation_sagas(tenant_id,repository_id,idempotency_key,request_digest,organization_id,ledger_reservation_id,estimated_amount,status,response) VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8) ON CONFLICT(tenant_id,repository_id,idempotency_key) DO NOTHING RETURNING response`, [input.tenantId,input.repositoryId,input.idempotencyKey,digest,input.organizationId,reservation.reservationId,input.amount,reservation]);
      if (!inserted.rowCount) throw new TypeError("BUDGET_RESERVATION_RACE"); await client.query(`INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope) VALUES($1,$2,$3,$4,'evolution.events.v1',$5,$6)`, [input.tenantId,randomUUID(),input.repositoryId,reservation.reservationId,`${input.tenantId}/${input.repositoryId}/budget`,{type:"BudgetReserved",reservationId:reservation.reservationId,amount:input.amount,correlationId:input.correlationId}]); return reservation;
    });
  }
}
