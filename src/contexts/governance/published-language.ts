import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
import type { TenantId, RepositoryId } from "../../shared-kernel/identity.js";
export const publishedLanguage = "agentics.governance/v1" as const;
export type PromotionAuthorized = EvolutionEnvelope<{ readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly approvalId: string }> & { readonly type: "PromotionAuthorized" };
export type AuthorizationRevoked = EvolutionEnvelope<{ readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly approvalId: string }> & { readonly type: "AuthorizationRevoked" };
