import type { AggregateScope } from "../../context-boundary.js";

export interface KnowledgeContributionBoundary extends AggregateScope {
  readonly aggregateKind: "KnowledgeContribution";
}
