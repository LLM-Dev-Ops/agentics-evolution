import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
import type { TenantId, RepositoryId } from "../../shared-kernel/identity.js";
import type { DigestReference } from "../../shared-kernel/digest.js";
export const publishedLanguage = "agentics.dream/v1" as const;
export type HypothesisProposed = EvolutionEnvelope<{ readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly hypothesisRef: DigestReference }> & { readonly type: "HypothesisProposed" };
