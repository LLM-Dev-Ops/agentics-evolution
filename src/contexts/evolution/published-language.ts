import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
import type { TenantId, RepositoryId } from "../../shared-kernel/identity.js";
import type { DigestReference } from "../../shared-kernel/digest.js";
export const publishedLanguage = "agentics.evolution/v1" as const;
export type CandidateGenerated = EvolutionEnvelope<{ readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly candidateRef: DigestReference }> & { readonly type: "CandidateGenerated" };
