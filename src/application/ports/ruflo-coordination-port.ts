import type { ArtifactReference, PortResponse, ReadValue, UpstreamCallContext } from "./acl-contract.js";

export type WorkStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface CoordinationRequest { readonly objective: string; readonly capabilityRef: string; readonly input: ArtifactReference; }
export interface CoordinatedWork { readonly workId: string; readonly status: ReadValue<WorkStatus>; readonly result?: ArtifactReference; }

export interface RufloCoordinationPort {
  start(request: CoordinationRequest, context: UpstreamCallContext): Promise<PortResponse<CoordinatedWork>>;
  dispatch(workId: string, workerType: string, context: UpstreamCallContext): Promise<PortResponse<CoordinatedWork>>;
  cancel(workId: string, context: UpstreamCallContext): Promise<PortResponse<CoordinatedWork>>;
  status(workId: string, context: UpstreamCallContext): Promise<PortResponse<CoordinatedWork>>;
  trajectory(workId: string, context: UpstreamCallContext): Promise<PortResponse<ArtifactReference>>;
  route(taskClass: string, context: UpstreamCallContext): Promise<PortResponse<{ readonly route: string; readonly confidence: number }>>;
}
