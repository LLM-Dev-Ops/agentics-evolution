import { capabilityActions, type CapabilityAction } from "../domain/capability.js";
import type { IdentityVerifier, VerifiedIdentity } from "./identity.js";

export interface EnforcementRequest { readonly tenantId: string; readonly repositoryId: string; readonly action: CapabilityAction; readonly policyEpoch: string; readonly correlationId: string; }
export interface BoundEnforcementDecision { readonly schema: "agentics.governance-decision/v1"; readonly allowed: boolean; readonly action: CapabilityAction;
  readonly tenantId: string; readonly repositoryId: string; readonly policyEpoch: string; readonly decisionDigest: string; readonly evidenceDigest: string; readonly reason: string; }
export interface BoundGovernancePort { decide(request: EnforcementRequest & { readonly identity: VerifiedIdentity }): Promise<BoundEnforcementDecision>; }
export interface GovernanceAuditPort { append(record: Readonly<{ request: EnforcementRequest; identitySubject: string; decision: BoundEnforcementDecision }>): Promise<void>; }

export class GovernanceEnforcementMiddleware {
  constructor(private readonly identities: IdentityVerifier, private readonly governance: BoundGovernancePort, private readonly audit: GovernanceAuditPort) {}
  async authorize(token: string, request: EnforcementRequest, audience: string): Promise<Readonly<{ identity: VerifiedIdentity; decision: BoundEnforcementDecision }>> {
    if (!capabilityActions.includes(request.action)) throw new TypeError("UNKNOWN_GOVERNANCE_ACTION");
    const identity = await this.identities.verify(token, audience);
    if (identity.tenantId !== request.tenantId) throw new TypeError("IDENTITY_TENANT_SCOPE_MISMATCH");
    const decision = await this.governance.decide({ ...request, identity });
    if (decision.schema !== "agentics.governance-decision/v1" || decision.action !== request.action || decision.tenantId !== request.tenantId ||
      decision.repositoryId !== request.repositoryId || decision.policyEpoch !== request.policyEpoch || !/^[a-f0-9]{64}$/.test(decision.decisionDigest) ||
      !/^[a-f0-9]{64}$/.test(decision.evidenceDigest)) throw new TypeError("GOVERNANCE_DECISION_BINDING_REJECTED");
    await this.audit.append(Object.freeze({ request, identitySubject: identity.subject, decision }));
    if (!decision.allowed) throw new TypeError("GOVERNANCE_AUTHORIZATION_DENIED");
    return Object.freeze({ identity, decision });
  }
}
