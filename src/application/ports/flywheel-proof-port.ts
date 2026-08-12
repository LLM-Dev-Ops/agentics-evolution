import type { ArtifactReference, PortResponse, ReadValue, UpstreamCallContext } from "./acl-contract.js";

export type ProofVerdict = "PROMOTED" | "REJECTED";

export interface FlywheelGateRequest {
  readonly baselineScores: ArtifactReference;
  readonly candidateScores: ArtifactReference;
  readonly anchorScores?: ArtifactReference;
  readonly evidenceEpoch: string;
}

export interface FlywheelGateResult {
  readonly verdict: ReadValue<ProofVerdict>;
  readonly reasons: readonly string[];
  readonly receipt: ArtifactReference;
}

export interface ReplayResult {
  readonly valid: boolean;
  readonly failures: readonly string[];
  readonly lineage: ArtifactReference;
}

export interface FlywheelProofPort {
  evaluateGate(request: FlywheelGateRequest, context: UpstreamCallContext): Promise<PortResponse<FlywheelGateResult>>;
  verifyReceipt(receipt: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<{ readonly valid: boolean }>>;
  verifyReplay(bundle: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<ReplayResult>>;
  walkLineage(head: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<readonly ArtifactReference[]>>;
}
