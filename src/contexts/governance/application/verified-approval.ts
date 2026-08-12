import { canonicalJson } from "../../../shared-kernel/immutable.js";
import { digestBytes } from "../../../shared-kernel/digest.js";
import type { VerifiedIdentity } from "./identity.js";
import type { CapabilityEnvelope } from "../domain/capability.js";

export interface ApprovalScope { readonly tenantId: string; readonly repositoryId: string; readonly action: "promotion.authorize"; }
export interface BoundApprovalDecision { readonly schema: "agentics.governance-decision/v1"; readonly outcome: "ALLOW"; readonly decisionId: string;
  readonly decisionDigest: string; readonly evidenceDigest: string; readonly policyEpoch: string; readonly scope: ApprovalScope; }
export interface ApprovalRecord { readonly authorizationId: string; readonly requesterSubject: string; readonly candidateDigest: string;
  readonly evidenceDigest: string; readonly policyEpoch: string; readonly envelope: CapabilityEnvelope; }
export interface ApprovalEvidencePort { verify(decision: BoundApprovalDecision): Promise<boolean>; }
export interface BoundApprovalStore { approveBound(tenantId: string, authorizationId: string, approverSubject: string,
  envelope: CapabilityEnvelope, decision: BoundApprovalDecision): Promise<void>; }

export const canonicalIdentitySubject = (identity: Pick<VerifiedIdentity, "issuer" | "subject">): string =>
  `${identity.issuer.normalize("NFC")}#${identity.subject.normalize("NFC")}`;

export class VerifiedApprovalAuthority {
  readonly #groups: ReadonlySet<string>;
  constructor(groups: readonly string[], private readonly evidence: ApprovalEvidencePort, private readonly store: BoundApprovalStore) {
    if (!groups.length || groups.some((group) => !group)) throw new TypeError("APPROVAL_GROUP_CONFIGURATION_REQUIRED");
    this.#groups = new Set(groups);
  }
  async approve(identity: VerifiedIdentity, record: ApprovalRecord, decision: BoundApprovalDecision): Promise<void> {
    const subject = canonicalIdentitySubject(identity);
    if (identity.kind !== "HUMAN" || !identity.mfa || !identity.groups.some((group) => this.#groups.has(group))) throw new TypeError("VERIFIED_HUMAN_APPROVER_REQUIRED");
    if (subject === record.requesterSubject) throw new TypeError("APPROVAL_SEPARATION_OF_DUTIES");
    if (decision.schema !== "agentics.governance-decision/v1" || decision.outcome !== "ALLOW" || decision.scope.action !== "promotion.authorize" ||
      decision.scope.tenantId !== record.envelope.tenantId || !record.envelope.repositories.includes(decision.scope.repositoryId) ||
      decision.policyEpoch !== record.policyEpoch || decision.evidenceDigest !== record.evidenceDigest ||
      decision.decisionDigest !== decisionDigest(decision)) throw new TypeError("APPROVAL_DECISION_BINDING_REJECTED");
    if (!await this.evidence.verify(decision)) throw new TypeError("APPROVAL_EVIDENCE_REJECTED");
    await this.store.approveBound(decision.scope.tenantId, record.authorizationId, subject, record.envelope, decision);
  }
}

export function decisionDigest(value: Omit<BoundApprovalDecision, "decisionDigest"> | BoundApprovalDecision): string {
  const { decisionDigest: _discarded, ...bound } = value as BoundApprovalDecision;
  return digestBytes(new TextEncoder().encode(canonicalJson(bound)));
}
