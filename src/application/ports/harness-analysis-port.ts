import type { ArtifactReference, PortResponse, UpstreamCallContext } from "./acl-contract.js";

export interface HarnessAnalysisRequest {
  readonly sourceSnapshot: ArtifactReference;
  readonly requestedChecks: readonly string[];
}

export interface HarnessAnalysisEvidence {
  readonly readiness: "READY" | "NOT_READY";
  readonly genome: ArtifactReference;
  readonly report: ArtifactReference;
  readonly findings: readonly { readonly code: string; readonly severity: "INFO" | "WARNING" | "ERROR" }[];
}

export interface HarnessAnalysisPort {
  analyze(request: HarnessAnalysisRequest, context: UpstreamCallContext): Promise<PortResponse<HarnessAnalysisEvidence>>;
}
