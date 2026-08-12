/** Infrastructure composition marker. Never exported from the context package. */
export const infrastructureContext = "artifact-lineage" as const;
export { LocalPurposeBoundSigner, RemotePurposeBoundSigner } from "./purpose-bound-signers.js";
export type { RemoteAsymmetricSigningProvider, SigningCapability } from "./purpose-bound-signers.js";
