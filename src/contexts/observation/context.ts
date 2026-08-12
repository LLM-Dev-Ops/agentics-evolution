import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "observation", aggregate: "EvidenceBatch" } as const satisfies ContextDescriptor;
