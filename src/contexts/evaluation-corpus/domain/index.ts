import type { AggregateScope } from "../../context-boundary.js";

export interface CorpusVersionBoundary extends AggregateScope {
  readonly aggregateKind: "CorpusVersion";
}
