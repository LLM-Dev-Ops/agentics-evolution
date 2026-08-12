import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
export const publishedLanguage = "agentics.governance/v1" as const;
export type PromotionAuthorized = EvolutionEnvelope<{ readonly tenantId: string; readonly repositoryId: string; readonly approvalId: string }> & { readonly type: "PromotionAuthorized" };
export type AuthorizationRevoked = EvolutionEnvelope<{ readonly tenantId: string; readonly repositoryId: string; readonly approvalId: string }> & { readonly type: "AuthorizationRevoked" };
