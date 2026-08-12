export const TRUST_STATES = ["IMAGINED", "PRODUCED", "PROVED", "AUTHORIZED"] as const;
export type TrustState = typeof TRUST_STATES[number];
export type TrustCommand = "ProposeHypothesis" | "GenerateCandidate" | "AcceptEvaluation" | "AuthorizePromotion";
const TRANSITIONS: Readonly<Record<TrustCommand, readonly [TrustState | null, TrustState]>> = Object.freeze({
  ProposeHypothesis: [null, "IMAGINED"], GenerateCandidate: ["IMAGINED", "PRODUCED"],
  AcceptEvaluation: ["PRODUCED", "PROVED"], AuthorizePromotion: ["PROVED", "AUTHORIZED"]
});
export interface TransitionEvidence { readonly sourceValidated?: true; readonly mutationAdmitted?: true; readonly proofVerified?: true; readonly independentAuthorization?: true; }
export function transitionTrust(current: TrustState | null, command: TrustCommand, evidence: TransitionEvidence): TrustState {
  const [expected, next] = TRANSITIONS[command];
  if (current !== expected) throw new TypeError(`illegal trust transition from ${current ?? "none"} using ${command}`);
  const gate = command === "ProposeHypothesis" ? evidence.sourceValidated : command === "GenerateCandidate" ? evidence.mutationAdmitted : command === "AcceptEvaluation" ? evidence.proofVerified : evidence.independentAuthorization;
  if (!gate) throw new TypeError(`required gate evidence missing for ${command}`);
  return next;
}
const servingBrand: unique symbol = Symbol("ServingAuthorization");
export interface ServingAuthorization { readonly aggregateId: string; readonly [servingBrand]: true; }
export function servingAuthorization(state: TrustState, aggregateId: string): ServingAuthorization {
  if (state !== "AUTHORIZED") throw new TypeError("only AUTHORIZED state may produce serving authorization");
  return Object.freeze({ aggregateId, [servingBrand]: true as const });
}
