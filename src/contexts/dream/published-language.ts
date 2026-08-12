import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
export const publishedLanguage = "agentics.dream/v1" as const;
export type HypothesisProposed = EvolutionEnvelope<{ readonly tenantId: string; readonly repositoryId: string; readonly hypothesisRef: string }> & { readonly type: "HypothesisProposed" };
