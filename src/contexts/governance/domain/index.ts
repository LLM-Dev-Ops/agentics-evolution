import type { AggregateScope } from "../../context-boundary.js";

export interface PromotionAuthorizationBoundary extends AggregateScope {
  readonly aggregateKind: "PromotionAuthorization";
}
export * from "./trust-aggregate.js";
