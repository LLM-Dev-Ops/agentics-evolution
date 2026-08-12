import type { AggregateScope } from "../../context-boundary.js";

export interface ArtifactManifestBoundary extends AggregateScope {
  readonly aggregateKind: "ArtifactManifest";
}
export * from "./artifact-manifest.js";
export * from "./key-manifest.js";
export type { SigningPurpose } from "./signing-purpose.js";
