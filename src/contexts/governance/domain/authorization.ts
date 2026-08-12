import type { CapabilityEnvelope } from "./capability.js";
import { isEnvelopeSubset, normalizeEnvelope } from "./capability.js";

export type AuthorizationState = "REQUESTED" | "APPROVED" | "CONSUMED" | "DENIED" | "EXPIRED" | "REVOKED";
export interface AuthorizationRequest { readonly id: string; readonly requester: string; readonly candidateDigest: string; readonly evidenceDigest: string;
  readonly environment: string; readonly expectedChampionVersion: number; readonly policyEpoch: string; readonly envelope: CapabilityEnvelope; readonly expiresAt: string; readonly maxUses: number; }
export interface PromotionAuthorization { readonly request: AuthorizationRequest; readonly state: AuthorizationState; readonly approvedEnvelope: CapabilityEnvelope | null;
  readonly approver: string | null; readonly uses: number; readonly version: number; }
export function requestAuthorization(request: AuthorizationRequest): PromotionAuthorization {
  if (!request.id || !request.requester || request.maxUses < 1 || !Number.isSafeInteger(request.maxUses) || !Number.isSafeInteger(request.expectedChampionVersion) || Date.parse(request.expiresAt) <= Date.now()) throw new TypeError("INVALID_AUTHORIZATION_REQUEST");
  return Object.freeze({ request: Object.freeze({ ...request, envelope: normalizeEnvelope(request.envelope) }), state: "REQUESTED", approvedEnvelope: null, approver: null, uses: 0, version: 0 });
}
export function approveAuthorization(value: PromotionAuthorization, approver: string, envelope: CapabilityEnvelope): PromotionAuthorization {
  if (value.state !== "REQUESTED" || !approver || approver === value.request.requester || !isEnvelopeSubset(envelope, value.request.envelope)) throw new TypeError("AUTHORIZATION_APPROVAL_REJECTED");
  return Object.freeze({ ...value, state: "APPROVED", approver, approvedEnvelope: normalizeEnvelope(envelope), version: value.version + 1 });
}
export function consumeAuthorization(value: PromotionAuthorization, now: string): PromotionAuthorization {
  if (value.state !== "APPROVED" || Date.parse(now) >= Date.parse(value.request.expiresAt) || value.uses >= value.request.maxUses) throw new TypeError("AUTHORIZATION_NOT_CONSUMABLE");
  const uses = value.uses + 1; return Object.freeze({ ...value, state: uses === value.request.maxUses ? "CONSUMED" : "APPROVED", uses, version: value.version + 1 });
}
export function terminateAuthorization(value: PromotionAuthorization, state: "DENIED" | "EXPIRED" | "REVOKED"): PromotionAuthorization {
  if (["CONSUMED", "DENIED", "EXPIRED", "REVOKED"].includes(value.state)) throw new TypeError("AUTHORIZATION_TERMINAL");
  return Object.freeze({ ...value, state, version: value.version + 1 });
}
