import type { ArtifactReference, PortResponse, UpstreamCallContext } from "./acl-contract.js";

export interface DarwinEvolutionRequest {
  readonly mutationContract: ArtifactReference;
  readonly sourceSnapshot: ArtifactReference;
  readonly seed: number;
  readonly generations: number;
  readonly childrenPerGeneration: number;
}

export interface DarwinCampaignResult {
  readonly campaignId: string;
  readonly status: "COMPLETED" | "CANCELLED" | "BUDGET_EXHAUSTED";
  readonly candidates: readonly ArtifactReference[];
  readonly archive: ArtifactReference;
  readonly checkpoint?: ArtifactReference;
}

export interface CandidateInspection {
  readonly admitted: boolean;
  readonly findings: readonly string[];
}

export interface DarwinEvolutionPort {
  evolve(request: DarwinEvolutionRequest, context: UpstreamCallContext): Promise<PortResponse<DarwinCampaignResult>>;
  inspectCandidate(candidate: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<CandidateInspection>>;
  validateGeneratedCandidate(source: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<CandidateInspection>>;
}
