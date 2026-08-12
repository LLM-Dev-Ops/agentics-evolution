import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";

export type IdentityKind = "HUMAN" | "SERVICE";
export interface VerifiedIdentity { readonly kind: IdentityKind; readonly subject: string; readonly tenantId: TenantId; readonly issuer: string;
  readonly audience: string; readonly groups: readonly string[]; readonly serviceAccount: string | null; readonly mfa: boolean; readonly expiresAt: string; }
export interface IdentityVerifier { verify(token: string, expectedAudience: string): Promise<VerifiedIdentity>; }
export interface AuthorizationCheckRequest { readonly identity: VerifiedIdentity; readonly tenantId: TenantId; readonly repositoryId: RepositoryId;
  readonly action: string; readonly correlationId: string; }
export interface GovernanceDecision { readonly allowed: boolean; readonly decisionDigest: string; readonly reason: string; }
export interface GovernanceAuthorizationPort { decide(request: AuthorizationCheckRequest): Promise<GovernanceDecision>; }

/** Authentication supplies identity facts only; only Governance can grant the requested action. */
export class AuthorizationMiddleware {
  constructor(private readonly identities: IdentityVerifier, private readonly governance: GovernanceAuthorizationPort) {}
  async authorize(token: string, request: Omit<AuthorizationCheckRequest, "identity">, audience: string): Promise<{ identity: VerifiedIdentity; decision: GovernanceDecision }> {
    const identity = await this.identities.verify(token, audience);
    if (identity.tenantId !== request.tenantId) throw new TypeError("IDENTITY_TENANT_SCOPE_MISMATCH");
    const decision = await this.governance.decide({ ...request, identity });
    if (!decision.allowed) throw new TypeError("GOVERNANCE_AUTHORIZATION_DENIED");
    return Object.freeze({ identity, decision });
  }
}
