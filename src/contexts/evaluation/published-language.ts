import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
export const publishedLanguage = "agentics.evaluation/v1" as const;
export type EvaluationAccepted = EvolutionEnvelope<{ readonly tenantId: string; readonly repositoryId: string; readonly receiptRef: string }> & { readonly type: "EvaluationAccepted" };
