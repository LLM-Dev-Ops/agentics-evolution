import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
export const publishedLanguage = "agentics.evolution/v1" as const;
export type CandidateGenerated = EvolutionEnvelope<{ readonly tenantId: string; readonly repositoryId: string; readonly candidateRef: string }> & { readonly type: "CandidateGenerated" };
