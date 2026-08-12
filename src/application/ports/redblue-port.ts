import type { ArtifactReference, PortResponse, UpstreamCallContext } from "./acl-contract.js";

export interface AdversarialRunRequest { readonly target: ArtifactReference; readonly suite: ArtifactReference; readonly maxTests: number; }
export interface AdversarialResult {
  readonly compromised: number;
  readonly total: number;
  readonly blocksProduction: boolean;
  readonly report: ArtifactReference;
}

export interface RedBluePort {
  runBaseline(request: AdversarialRunRequest, context: UpstreamCallContext): Promise<PortResponse<AdversarialResult>>;
  retest(baseline: ArtifactReference, patches: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<AdversarialResult>>;
  buildReport(result: ArtifactReference, context: UpstreamCallContext): Promise<PortResponse<ArtifactReference>>;
}
