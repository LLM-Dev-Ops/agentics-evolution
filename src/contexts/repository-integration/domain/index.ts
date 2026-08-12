import type { AggregateScope } from "../../context-boundary.js";

export interface RepositoryConnectionBoundary extends AggregateScope {
  readonly aggregateKind: "RepositoryConnection";
}
