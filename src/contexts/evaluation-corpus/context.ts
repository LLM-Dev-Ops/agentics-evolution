import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "evaluation-corpus", aggregate: "CorpusVersion" } as const satisfies ContextDescriptor;
