import type { AggregateScope } from "../../context-boundary.js";

export interface EvaluationLineageBoundary extends AggregateScope {
  readonly aggregateKind: "EvaluationLineage";
}
