import { canonicalJson } from "../../../shared-kernel/immutable.js";
import { digestBytes } from "../../../shared-kernel/digest.js";
import type { VerifiedIdentity } from "./identity.js";
import type { CapabilityEnvelope } from "../domain/capability.js";
import{createPublicKey,verify}from"node:crypto";

export interface ApprovalScope { readonly tenantId: string; readonly repositoryId: string; readonly action: "promotion.authorize"; }
export interface BoundApprovalDecision { readonly schema: "agentics.governance-decision/v1"; readonly outcome: "ALLOW"; readonly decisionId: string;
  readonly decisionDigest: string; readonly evidenceDigest: string; readonly policyEpoch: string; readonly scope: ApprovalScope;readonly keyId:string;readonly signature:string;
  readonly authorizationId:string;readonly candidateDigest:string;readonly approvedEnvelopeDigest:string;readonly expiresAt:string;readonly maxUses:number; }
export interface ApprovalRecord { readonly authorizationId: string; readonly requesterSubject: string; readonly candidateDigest: string;
  readonly evidenceDigest: string; readonly policyEpoch: string; readonly envelope: CapabilityEnvelope;readonly expiresAt:string;readonly maxUses:number; }
const promotionVerifiers=new WeakSet<object>();
const promotionKeys=new WeakMap<object,ReadonlyMap<string,ReturnType<typeof createPublicKey>>>();
export class Ed25519PromotionApprovalVerifier{constructor(roots:Readonly<Record<string,string>>){const entries=Object.entries(roots).map(([id,pem])=>[id,createPublicKey(pem)]as const);if(!entries.length||entries.some(([,key])=>key.asymmetricKeyType!=="ed25519"))throw new TypeError("PROMOTION_APPROVAL_TRUST_ROOT_REQUIRED");promotionKeys.set(this,new Map(entries));promotionVerifiers.add(this);Object.freeze(this);}verify(decision:BoundApprovalDecision):boolean{return verifyPromotion(this,decision);}}
function verifyPromotion(owner:object,decision:BoundApprovalDecision):boolean{const key=promotionKeys.get(owner)?.get(decision.keyId);if(!key)return false;const{signature,...payload}=decision;return verify(null,Buffer.from(canonicalJson(payload)),key,Buffer.from(signature,"base64url"));}
declare const verifiedApprovalBrand: unique symbol;
export interface VerifiedApproval { readonly decision: BoundApprovalDecision; readonly approverSubject: string; readonly [verifiedApprovalBrand]: true; }
const mintedApprovals = new WeakSet<object>();
export function requireVerifiedApproval(value: VerifiedApproval): void { if(!value||!mintedApprovals.has(value as object))throw new TypeError("VERIFIED_APPROVAL_REQUIRED"); }
export interface BoundApprovalStore { approveBound(tenantId: string, authorizationId: string, approverSubject: string,
  envelope: CapabilityEnvelope, approval: VerifiedApproval): Promise<void>; }

export const canonicalIdentitySubject = (identity: Pick<VerifiedIdentity, "issuer" | "subject">): string =>
  `${identity.issuer.normalize("NFC")}#${identity.subject.normalize("NFC")}`;

export class VerifiedApprovalAuthority {
  readonly #groups: ReadonlySet<string>;
  constructor(groups: readonly string[], private readonly evidence: Ed25519PromotionApprovalVerifier, private readonly store: BoundApprovalStore) {
    if (!groups.length || groups.some((group) => !group)) throw new TypeError("APPROVAL_GROUP_CONFIGURATION_REQUIRED");
    if(Object.getPrototypeOf(evidence)!==Ed25519PromotionApprovalVerifier.prototype||!Object.isFrozen(evidence)||!promotionVerifiers.has(evidence))throw new TypeError("PINNED_PROMOTION_VERIFIER_REQUIRED");
    this.#groups = new Set(groups);
  }
  async approve(identity: VerifiedIdentity, record: ApprovalRecord, decision: BoundApprovalDecision): Promise<void> {
    const subject = canonicalIdentitySubject(identity);
    if (identity.kind !== "HUMAN" || !identity.mfa || !identity.groups.some((group) => this.#groups.has(group))) throw new TypeError("VERIFIED_HUMAN_APPROVER_REQUIRED");
    if (subject === record.requesterSubject) throw new TypeError("APPROVAL_SEPARATION_OF_DUTIES");
    if (decision.schema !== "agentics.governance-decision/v1" || decision.outcome !== "ALLOW" || decision.scope.action !== "promotion.authorize" ||
      decision.scope.tenantId !== record.envelope.tenantId || !record.envelope.repositories.includes(decision.scope.repositoryId) ||
      decision.policyEpoch !== record.policyEpoch || decision.evidenceDigest !== record.evidenceDigest ||
      decision.authorizationId!==record.authorizationId||decision.candidateDigest!==record.candidateDigest||decision.approvedEnvelopeDigest!==capabilityEnvelopeDigest(record.envelope)||decision.expiresAt!==record.expiresAt||decision.maxUses!==record.maxUses||
      decision.decisionDigest !== decisionDigest(decision)) throw new TypeError("APPROVAL_DECISION_BINDING_REJECTED");
    if (!verifyPromotion(this.evidence,decision)) throw new TypeError("APPROVAL_EVIDENCE_REJECTED");
    const approval=Object.freeze({decision,approverSubject:subject}) as VerifiedApproval;mintedApprovals.add(approval);
    await this.store.approveBound(decision.scope.tenantId, record.authorizationId, subject, record.envelope, approval);
  }
}
export function capabilityEnvelopeDigest(value:CapabilityEnvelope):string{return digestBytes(new TextEncoder().encode(canonicalJson(JSON.parse(JSON.stringify(value,(_k,item)=>typeof item==="bigint"?item.toString():item)))));}

export function decisionDigest(value: Omit<BoundApprovalDecision, "decisionDigest"> | BoundApprovalDecision): string {
  const { decisionDigest: _discarded,signature:_signature, ...bound } = value as BoundApprovalDecision;
  return digestBytes(new TextEncoder().encode(canonicalJson(bound)));
}
