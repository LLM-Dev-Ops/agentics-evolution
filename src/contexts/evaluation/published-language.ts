import type { EvolutionEnvelope } from "../../shared-kernel/evolution-envelope.js";
import type { TenantId, RepositoryId } from "../../shared-kernel/identity.js";
import type { DigestReference } from "../../shared-kernel/digest.js";
export const publishedLanguage = "agentics.evaluation/v1" as const;
export type EvaluationAccepted = EvolutionEnvelope<{ readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly receiptRef: DigestReference }> & { readonly type: "EvaluationAccepted" };
