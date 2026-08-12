import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "repository-integration", aggregate: "RepositoryConnection" } as const satisfies ContextDescriptor;
