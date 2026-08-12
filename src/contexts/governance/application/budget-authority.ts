import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { LedgerReservation } from "./upstream-authority-ports.js";
export interface BudgetReservationRequest { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly organizationId: string; readonly amount: string; readonly ttlSeconds: number; readonly idempotencyKey: string; readonly actor: string; readonly correlationId: string; }
export interface BudgetAuthorityPort { reserve(input: BudgetReservationRequest, signal: AbortSignal): Promise<LedgerReservation>; }
