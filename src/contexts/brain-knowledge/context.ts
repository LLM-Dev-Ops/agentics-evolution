import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "brain-knowledge", aggregate: "KnowledgeContribution" } as const satisfies ContextDescriptor;
