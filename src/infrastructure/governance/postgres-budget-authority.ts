import { randomUUID } from "node:crypto";
import type { BudgetAuthorityPort, BudgetReservationRequest, BudgetTransitionRequest } from "../../contexts/governance/application/budget-authority.js";
import type { AuthoritativeLedgerReservation, UsageLedgerPort } from "../../contexts/governance/application/upstream-authority-ports.js";
import type { PostgresPersistence } from "../../persistence/postgres.js";
import { withSerializableRetry } from "../../persistence/postgres.js";
import { digestBytes } from "../../shared-kernel/digest.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";
export class PostgresBudgetAuthority implements BudgetAuthorityPort {
  constructor(private readonly database: PostgresPersistence, private readonly ledger: UsageLedgerPort) {}
  async reserve(input: BudgetReservationRequest, signal: AbortSignal): Promise<AuthoritativeLedgerReservation> {
    const digest = digestBytes(new TextEncoder().encode(canonicalJson(input)));
    const existing = await withSerializableRetry(() => this.database.tenantTransaction(input.tenantId, "SERIALIZABLE", async client => {
      await client.query(`INSERT INTO budget_reservation_sagas(tenant_id,repository_id,idempotency_key,request_digest,organization_id,estimated_amount,status) VALUES($1,$2,$3,$4,$5,$6,'REQUESTED') ON CONFLICT DO NOTHING`, [input.tenantId,input.repositoryId,input.idempotencyKey,digest,input.organizationId,input.amount]);
      const row = (await client.query("SELECT request_digest,response,status FROM budget_reservation_sagas WHERE tenant_id=$1 AND repository_id=$2 AND idempotency_key=$3 FOR UPDATE", [input.tenantId,input.repositoryId,input.idempotencyKey])).rows[0]; if (row?.request_digest !== digest) throw new TypeError("BUDGET_IDEMPOTENCY_CONFLICT"); return row; }), { maxAttempts: 32, baseDelayMs: 2, deadlineMs: Date.now() + 30_000 });
    if (existing?.status === "RESERVED") return existing.response as AuthoritativeLedgerReservation;
    const reservation = await this.ledger.reserve(input, signal);
    validateAuthority(reservation,input.organizationId,input.amount);
    return withSerializableRetry(() => this.database.tenantTransaction(input.tenantId, "SERIALIZABLE", async client => {
      const updated = await client.query(`UPDATE budget_reservation_sagas SET ledger_reservation_id=$4,status='RESERVED',response=$5,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND repository_id=$2 AND idempotency_key=$3 AND status='REQUESTED' RETURNING response`, [input.tenantId,input.repositoryId,input.idempotencyKey,reservation.reservationId,reservation]);
      if (!updated.rowCount) { const row=(await client.query("SELECT response FROM budget_reservation_sagas WHERE tenant_id=$1 AND repository_id=$2 AND idempotency_key=$3",[input.tenantId,input.repositoryId,input.idempotencyKey])).rows[0]; if (row?.response?.reservationId===reservation.reservationId) return row.response as AuthoritativeLedgerReservation; throw new TypeError("BUDGET_RESERVATION_RACE"); }
      await this.outbox(client,input,"BudgetReserved",reservation.reservationId,{amount:input.amount,correlationId:input.correlationId}); return reservation;
    }), { maxAttempts: 32, baseDelayMs: 2, deadlineMs: Date.now() + 30_000 });
  }
  /** Replays the original key through the upstream authority, then converges local saga state. */
  async reconcile(input: BudgetReservationRequest, signal: AbortSignal): Promise<AuthoritativeLedgerReservation> { return this.reserve(input, signal); }
  async consume(input: BudgetTransitionRequest & { actualAmount: string }, signal: AbortSignal): Promise<void> {
    const result = await this.ledger.consume({ reservationId: input.reservationId, actualAmount: input.actualAmount, idempotencyKey: input.idempotencyKey, actor: input.actor }, signal);
    await this.transition(input,"RESERVED","CONSUMED",result,input.actualAmount,"BudgetConsumed");
  }
  async cancel(input: BudgetTransitionRequest, signal: AbortSignal): Promise<void> {
    const result = await this.ledger.cancel({ reservationId: input.reservationId, actor: input.actor }, signal);
    await this.transition(input,"RESERVED","CANCELLED",result,undefined,"BudgetCancelled");
  }
  private async transition(input: BudgetTransitionRequest, from: string, to: string, response: object, actualAmount: string | undefined, event: string): Promise<void> {
    await withSerializableRetry(() => this.database.tenantTransaction(input.tenantId,"SERIALIZABLE",async client => { const result=await client.query(`UPDATE budget_reservation_sagas SET status=$4,response=$5,actual_amount=$6,operation_idempotency_key=$7,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND repository_id=$2 AND ledger_reservation_id=$3 AND status=$8 RETURNING idempotency_key`,[input.tenantId,input.repositoryId,input.reservationId,to,response,actualAmount??null,input.idempotencyKey,from]); if(!result.rowCount){const row=(await client.query("SELECT status,operation_idempotency_key FROM budget_reservation_sagas WHERE tenant_id=$1 AND repository_id=$2 AND ledger_reservation_id=$3",[input.tenantId,input.repositoryId,input.reservationId])).rows[0];if(row?.status===to&&row.operation_idempotency_key===input.idempotencyKey)return;throw new TypeError("BUDGET_TRANSITION_CONFLICT");} await this.outbox(client,input,event,input.reservationId,{actualAmount}); }), { maxAttempts: 8, baseDelayMs: 2, deadlineMs: Date.now() + 10_000 });
  }
  private async outbox(client: import("pg").PoolClient,input:{tenantId:string;repositoryId:string},type:string,reservationId:string,payload:object){await client.query(`INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope) VALUES($1,$2,$3,$4,'evolution.events.v1',$5,$6)`,[input.tenantId,randomUUID(),input.repositoryId,reservationId,`${input.tenantId}/${input.repositoryId}/${reservationId}`,{type,reservationId,...payload}]);}
}
function validateAuthority(value:AuthoritativeLedgerReservation,organizationId:string,amount:string):void{const receipt=value.balanceAuthority;if(!receipt||receipt.authority!=="agentics-usage-ledger"||receipt.organizationId!==organizationId||!Number.isFinite(Date.parse(receipt.observedAt)))throw new TypeError("LEDGER_BALANCE_AUTHORITY_INVALID");const current=units(receipt.currentBalance),reserved=units(receipt.reservedAmount),available=units(receipt.availableBalance);if(current-reserved!==available||reserved<units(amount))throw new TypeError("LEDGER_BALANCE_AUTHORITY_INVALID");}
function units(value:string):bigint{if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value))throw new TypeError("LEDGER_BALANCE_AUTHORITY_INVALID");const [whole,fraction=""]=value.split(".");return BigInt(whole!)*1_000_000n+BigInt(fraction.padEnd(6,"0"));}
