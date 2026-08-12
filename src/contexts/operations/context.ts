import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "operations", aggregate: "RepositoryEnrollment" } as const satisfies ContextDescriptor;
