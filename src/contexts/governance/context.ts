import type { ContextDescriptor } from "../context-boundary.js";

export const context = { name: "governance", aggregate: "PromotionAuthorization" } as const satisfies ContextDescriptor;
