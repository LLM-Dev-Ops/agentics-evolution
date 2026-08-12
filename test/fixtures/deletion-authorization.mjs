import { randomUUID, sign } from "node:crypto";
import { VerifiedDeletionAuthority } from "../../dist/contexts/governance/application/deletion-authorization.js";
import { Ed25519DeletionApprovalEvidenceVerifier } from "../../dist/infrastructure/governance/ed25519-deletion-approval-verifier.js";
import { canonicalJson } from "../../dist/shared-kernel/immutable.js";
import { digestBytes } from "../../dist/index.js";

export function signedDeletionAuthorization(tombstone,pair,{subject="deleter",issuer="fixture",keyId="delete/fixture-1"}={}){
  const approverSubject=`${issuer}#${subject}`;const base={schema:"agentics.deletion-approval/v1",keyId,decisionId:randomUUID(),evidenceDigest:"ab".repeat(32),policyEpoch:tombstone.policyEpoch,action:"repository.delete",tenantId:tombstone.tenantId,repositoryId:tombstone.repositoryId,requestId:tombstone.requestId,approverSubject,expiresAt:"2099-01-01T00:00:00Z",irreversible:true};
  const binding={schema:base.schema,decisionId:base.decisionId,evidenceDigest:base.evidenceDigest,policyEpoch:base.policyEpoch,action:base.action,tenantId:base.tenantId,repositoryId:base.repositoryId,requestId:base.requestId,approverSubject:base.approverSubject,expiresAt:base.expiresAt,irreversible:base.irreversible};const payload={...base,decisionDigest:digestBytes(new TextEncoder().encode(canonicalJson(binding)))};const evidence={...payload,signature:sign(null,Buffer.from(canonicalJson(payload)),pair.privateKey).toString("base64url")};
  const verifier=new Ed25519DeletionApprovalEvidenceVerifier({[keyId]:pair.publicKey.export({type:"spki",format:"pem"})});return new VerifiedDeletionAuthority(new Set(["deleters"]),verifier).authorize({kind:"HUMAN",subject,issuer,tenantId:tombstone.tenantId,audience:"agentics",groups:["deleters"],serviceAccount:null,mfa:true,expiresAt:"2099-01-01T00:00:00Z"},tombstone,evidence);
}
