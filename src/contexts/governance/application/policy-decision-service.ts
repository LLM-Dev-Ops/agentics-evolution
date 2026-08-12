import { digestBytes } from "../../../shared-kernel/digest.js";
import { canonicalJson } from "../../../shared-kernel/immutable.js";
import type { EnforcementPort, GovernanceAction, GovernanceScope, PolicyDecisionPort } from "./upstream-authority-ports.js";

const APPROVAL_REQUIRED = new Set<GovernanceAction>(["evidence.reset", "promotion.authorize", "rollout.start", "rollout.rollback", "repository.write", "release.publish"]);
export interface BoundedApproval { readonly action: GovernanceAction; readonly tenantId: string; readonly repositoryId: string; readonly policyEpoch: number; readonly expiresAt: string; readonly revoked: boolean; readonly usesRemaining: number; }
export interface ComposedDecision { readonly allowed: boolean; readonly reason: string; readonly decisionDigest: string; readonly observableOnly: boolean; }
export class PolicyDecisionService {
  constructor(private readonly policy: PolicyDecisionPort, private readonly enforcement: EnforcementPort, private readonly currentEpoch: () => Promise<number>) {}
  async decide(scope: GovernanceScope, facts: Readonly<Record<string, unknown>>, approval: BoundedApproval | undefined, signal: AbortSignal): Promise<ComposedDecision> {
    const readOnly = scope.action === "cycle.read";
    try {
      if (scope.policyEpoch !== await this.currentEpoch()) return decision(false,"POLICY_EPOCH_STALE",false);
      const [policy, enforcement] = await Promise.all([this.policy.evaluate(scope,facts,signal),this.enforcement.enforce({scope,facts},signal)]);
      if (policy.outcome === "DENY" || !enforcement.allowed) return decision(false,"DENY_OVERRIDES",false);
      if (policy.outcome !== "ALLOW") return decision(false,"DEFAULT_DENY",false);
      if (APPROVAL_REQUIRED.has(scope.action) && !validApproval(scope,approval)) return decision(false,"BOUNDED_APPROVAL_REQUIRED",false);
      return decision(true,"AUTHORIZED",false);
    } catch {
      return decision(readOnly,"AUTHORITY_UNAVAILABLE",readOnly);
    }
  }
}
function validApproval(scope: GovernanceScope, approval: BoundedApproval | undefined): boolean { return !!approval && !approval.revoked && approval.usesRemaining>0 && Date.parse(approval.expiresAt)>Date.now() && approval.action===scope.action && approval.tenantId===scope.tenantId && approval.repositoryId===scope.repositoryId && approval.policyEpoch===scope.policyEpoch; }
function decision(allowed:boolean,reason:string,observableOnly:boolean):ComposedDecision { const body={allowed,reason,observableOnly}; return Object.freeze({...body,decisionDigest:digestBytes(new TextEncoder().encode(canonicalJson(body)))}); }
