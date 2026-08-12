import type { AggregateScope } from "../../context-boundary.js";

export interface ArtifactManifestBoundary extends AggregateScope {
  readonly aggregateKind: "ArtifactManifest";
}
