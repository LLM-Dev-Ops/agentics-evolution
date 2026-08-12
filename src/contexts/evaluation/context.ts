import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "evaluation", aggregate: "EvaluationLineage" } as const satisfies ContextDescriptor;
