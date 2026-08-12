import type { AggregateScope } from "../../context-boundary.js";

export interface DreamCycleBoundary extends AggregateScope {
  readonly aggregateKind: "DreamCycle";
}
