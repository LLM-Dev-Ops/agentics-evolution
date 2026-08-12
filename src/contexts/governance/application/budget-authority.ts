import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { AuthoritativeLedgerReservation } from "./upstream-authority-ports.js";
export interface BudgetReservationRequest { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly organizationId: string; readonly amount: string; readonly ttlSeconds: number; readonly idempotencyKey: string; readonly actor: string; readonly correlationId: string; }
export interface BudgetTransitionRequest { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly reservationId: string; readonly idempotencyKey: string; readonly actor: string; readonly actualAmount?: string; }
export interface BudgetAuthorityPort { reserve(input: BudgetReservationRequest, signal: AbortSignal): Promise<AuthoritativeLedgerReservation>;
  reconcile(input: BudgetReservationRequest, signal: AbortSignal): Promise<AuthoritativeLedgerReservation>;
  consume(input: BudgetTransitionRequest & { readonly actualAmount: string }, signal: AbortSignal): Promise<void>;
  cancel(input: BudgetTransitionRequest, signal: AbortSignal): Promise<void>; }
