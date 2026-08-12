import type { VerifiedIdentity } from "./identity.js";
import { canonicalIdentitySubject } from "./verified-approval.js";
import type { DeletionTombstone } from "./privacy-boundaries.js";

export interface DeletionApprovalEvidence { readonly schema:"agentics.deletion-approval/v1";readonly keyId:string;readonly decisionId:string;readonly decisionDigest:string;readonly evidenceDigest:string;readonly policyEpoch:number;readonly action:"repository.delete";readonly tenantId:string;readonly repositoryId:string;readonly requestId:string;readonly approverSubject:string;readonly expiresAt:string;readonly irreversible:true;readonly signature:string; }
export interface DeletionApprovalEvidenceVerifier { verify(evidence:DeletionApprovalEvidence):boolean; }
declare const deletionBrand:unique symbol;
export interface VerifiedDeletionAuthorization {readonly tombstone:DeletionTombstone;readonly evidence:DeletionApprovalEvidence;readonly [deletionBrand]:true;}
const issued=new WeakSet<object>(),consumed=new WeakSet<object>();
export function consumeDeletionAuthorization(value:VerifiedDeletionAuthorization):DeletionTombstone{if(!value||!issued.has(value as object)||consumed.has(value as object))throw new TypeError("VERIFIED_DELETION_AUTHORIZATION_REQUIRED");if(Date.parse(value.evidence.expiresAt)<=Date.now())throw new TypeError("DELETION_AUTHORIZATION_EXPIRED");consumed.add(value as object);return value.tombstone;}
export class VerifiedDeletionAuthority{
 constructor(private readonly groups:ReadonlySet<string>,private readonly verifier:DeletionApprovalEvidenceVerifier){if(!groups.size)throw new TypeError("DELETION_APPROVAL_GROUP_REQUIRED");}
 authorize(identity:VerifiedIdentity,tombstone:DeletionTombstone,evidence:DeletionApprovalEvidence):VerifiedDeletionAuthorization{const subject=canonicalIdentitySubject(identity);if(identity.kind!=="HUMAN"||!identity.mfa||!identity.groups.some(group=>this.groups.has(group)))throw new TypeError("VERIFIED_DELETION_APPROVER_REQUIRED");if(evidence.schema!=="agentics.deletion-approval/v1"||evidence.action!=="repository.delete"||!evidence.irreversible||evidence.tenantId!==tombstone.tenantId||evidence.repositoryId!==tombstone.repositoryId||evidence.requestId!==tombstone.requestId||evidence.policyEpoch!==tombstone.policyEpoch||evidence.approverSubject!==subject||Date.parse(evidence.expiresAt)<=Date.now()||!this.verifier.verify(evidence))throw new TypeError("DELETION_APPROVAL_EVIDENCE_REJECTED");const result=Object.freeze({tombstone,evidence})as VerifiedDeletionAuthorization;issued.add(result);return result;}
}
