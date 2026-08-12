import type { AggregateScope } from "../../context-boundary.js";

export interface PromotionAuthorizationBoundary extends AggregateScope {
  readonly aggregateKind: "PromotionAuthorization";
}
export * from "./capability.js";
export * from "./authorization.js";
export * from "./delegation.js";
export * from "./privacy.js";
