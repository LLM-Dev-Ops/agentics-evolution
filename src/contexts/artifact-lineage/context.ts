import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "artifact-lineage", aggregate: "ArtifactManifest" } as const satisfies ContextDescriptor;
