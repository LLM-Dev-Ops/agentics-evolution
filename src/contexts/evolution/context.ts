import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "evolution", aggregate: "EvolutionCampaign" } as const satisfies ContextDescriptor;
