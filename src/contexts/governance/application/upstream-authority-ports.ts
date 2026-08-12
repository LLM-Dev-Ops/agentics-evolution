import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";

export type GovernanceAction = "cycle.read" | "cycle.run" | "candidate.generate" | "candidate.evaluate" | "evidence.reset" |
  "promotion.qualify" | "promotion.authorize" | "rollout.start" | "rollout.rollback" | "repository.write" | "release.publish";
export interface GovernanceScope { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly action: GovernanceAction; readonly actorId: string; readonly policyEpoch: number; }
export interface PolicyDecision { readonly outcome: "ALLOW" | "DENY" | "MODIFY" | "WARN"; readonly decisionId: string; readonly decisionDigest: string; readonly matchedPolicies: readonly string[]; readonly matchedRules: readonly string[]; }
export interface PolicyDecisionPort { evaluate(scope: GovernanceScope, facts: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<PolicyDecision>; }
export interface EnforcementDecision { readonly allowed: boolean; readonly decisionId: string; readonly reasonCode: string | null; }
export interface EnforcementPort { enforce(intent: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<EnforcementDecision>; }
export interface LedgerReservation { readonly reservationId: string; readonly status: "active" | "consumed" | "expired" | "cancelled"; readonly amount: string; readonly expiresAt: string; }
export interface LedgerBalanceAuthority { readonly authority: "agentics-usage-ledger"; readonly organizationId: string; readonly currentBalance: string; readonly reservedAmount: string; readonly availableBalance: string; readonly observedAt: string; }
export interface AuthoritativeLedgerReservation extends LedgerReservation { readonly balanceAuthority: LedgerBalanceAuthority; }
export interface UsageLedgerPort {
  reserve(input: { organizationId: string; amount: string; ttlSeconds: number; idempotencyKey: string; actor: string; correlationId: string }, signal: AbortSignal): Promise<AuthoritativeLedgerReservation>;
  consume(input: { reservationId: string; actualAmount: string; idempotencyKey: string; actor: string }, signal: AbortSignal): Promise<{ entryId: string; amount: string }>;
  cancel(input: { reservationId: string; actor: string }, signal: AbortSignal): Promise<LedgerReservation>;
}
