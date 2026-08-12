import type { AggregateScope } from "../../context-boundary.js";

export interface EvolutionCampaignBoundary extends AggregateScope {
  readonly aggregateKind: "EvolutionCampaign";
}
