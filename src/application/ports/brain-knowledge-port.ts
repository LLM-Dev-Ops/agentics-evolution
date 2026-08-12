import type { ArtifactReference, PortResponse, ReadValue, UpstreamCallContext } from "./acl-contract.js";

export type KnowledgeTrust = "PRIVATE_TRUSTED" | "EXTERNAL_UNTRUSTED";
export interface KnowledgeQuery { readonly namespace: string; readonly query: string; readonly limit: number; }
export interface KnowledgeMemory {
  readonly id: string;
  readonly namespace: string;
  readonly trust: ReadValue<KnowledgeTrust>;
  readonly content: ArtifactReference;
  readonly score?: number;
}

export interface BrainKnowledgePort {
  share(memory: Omit<KnowledgeMemory, "id" | "score">, context: UpstreamCallContext): Promise<PortResponse<KnowledgeMemory>>;
  search(query: KnowledgeQuery, context: UpstreamCallContext): Promise<PortResponse<readonly KnowledgeMemory[]>>;
  get(id: string, context: UpstreamCallContext): Promise<PortResponse<KnowledgeMemory | null>>;
  list(namespace: string, context: UpstreamCallContext): Promise<PortResponse<readonly KnowledgeMemory[]>>;
  vote(id: string, direction: "UP" | "DOWN", context: UpstreamCallContext): Promise<PortResponse<{ readonly accepted: boolean }>>;
  drift(namespace: string, context: UpstreamCallContext): Promise<PortResponse<ArtifactReference>>;
  partition(namespace: string, context: UpstreamCallContext): Promise<PortResponse<ArtifactReference>>;
  transfer(sourceNamespace: string, targetNamespace: string, context: UpstreamCallContext): Promise<PortResponse<ArtifactReference>>;
  status(context: UpstreamCallContext): Promise<PortResponse<{ readonly status: ReadValue<"READY" | "DEGRADED"> }>>;
}
