import type { AggregateScope } from "../../context-boundary.js";

export interface EvidenceBatchBoundary extends AggregateScope {
  readonly aggregateKind: "EvidenceBatch";
}
