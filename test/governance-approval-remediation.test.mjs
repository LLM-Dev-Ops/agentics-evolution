import assert from "node:assert/strict";
import test from "node:test";
import{generateKeyPairSync,sign}from"node:crypto";import{canonicalJson}from"../dist/shared-kernel/immutable.js";
import { money } from "../dist/index.js";
import { capabilityEnvelopeDigest,decisionDigest, VerifiedApprovalAuthority,Ed25519PromotionApprovalVerifier, GovernanceEnforcementMiddleware, DelegationChainResolver } from "../dist/contexts/governance/application/index.js";

const envelope=(overrides={})=>({action:"promotion.authorize",tenantId:"tenant-a",repositories:["repo-a"],paths:[],tools:[],network:[],providers:["private"],models:[],regions:["us"],classification:"RESTRICTED",spend:money(1n,"USD"),concurrency:1,expiresAt:"2030-01-01T00:00:00Z",depth:3,uses:1,...overrides});
const identity=(overrides={})=>({kind:"HUMAN",subject:"bob",tenantId:"tenant-a",issuer:"https://issuer",audience:"api",groups:["release-approvers"],serviceAccount:null,mfa:true,expiresAt:"2030-01-01T00:00:00Z",...overrides});
const record={authorizationId:"auth",requesterSubject:"https://issuer#alice",candidateDigest:"ab".repeat(32),evidenceDigest:"cd".repeat(32),policyEpoch:"epoch-1",envelope:envelope(),expiresAt:"2030-01-01T00:00:00Z",maxUses:1};
const unsigned={schema:"agentics.governance-decision/v1",outcome:"ALLOW",decisionId:"decision",evidenceDigest:record.evidenceDigest,policyEpoch:record.policyEpoch,scope:{tenantId:"tenant-a",repositoryId:"repo-a",action:"promotion.authorize"},authorizationId:record.authorizationId,candidateDigest:record.candidateDigest,approvedEnvelopeDigest:capabilityEnvelopeDigest(record.envelope),expiresAt:record.expiresAt,maxUses:record.maxUses};
const pair=generateKeyPairSync("ed25519"),verifier=new Ed25519PromotionApprovalVerifier({k:pair.publicKey.export({type:"spki",format:"pem"})});const prepared={...unsigned,keyId:"k"},digest=decisionDigest(prepared),payload={...prepared,decisionDigest:digest};const binding={...payload,signature:sign(null,Buffer.from(canonicalJson(payload)),pair.privateKey).toString("base64url")};

test("verified approval requires human MFA, configured group, canonical subject SoD and exact bindings",async()=>{let stored=0;const authority=new VerifiedApprovalAuthority(["release-approvers"],verifier,{approveBound:async()=>{stored++;}});
 await authority.approve(identity(),record,binding);assert.equal(stored,1);
 for(const invalid of [identity({kind:"SERVICE",serviceAccount:"bob@svc"}),identity({mfa:false}),identity({groups:["other"]}),identity({subject:"alice"})])await assert.rejects(authority.approve(invalid,record,binding),/APPROVER_REQUIRED|DUTIES/);
 await assert.rejects(authority.approve(identity(),record,{...binding,policyEpoch:"old"}),/BINDING/);
 assert.throws(()=>new VerifiedApprovalAuthority(["release-approvers"],{verify:()=>true},{approveBound:async()=>{}}),/PINNED/);class Evil extends Ed25519PromotionApprovalVerifier{}assert.throws(()=>new VerifiedApprovalAuthority(["release-approvers"],new Evil({k:pair.publicKey.export({type:"spki",format:"pem"})}),{approveBound:async()=>{}}),/PINNED/);const crafted=Object.freeze(Object.assign(Object.create(Ed25519PromotionApprovalVerifier.prototype),{verify:()=>true}));assert.throws(()=>new VerifiedApprovalAuthority(["release-approvers"],crafted,{approveBound:async()=>{}}),/PINNED/);
 const original=Ed25519PromotionApprovalVerifier.prototype.verify;try{Ed25519PromotionApprovalVerifier.prototype.verify=()=>true;await assert.rejects(authority.approve(identity(),record,{...binding,signature:"forged"}),/EVIDENCE/);const poisoned=new Ed25519PromotionApprovalVerifier({k:pair.publicKey.export({type:"spki",format:"pem"})});await assert.rejects(new VerifiedApprovalAuthority(["release-approvers"],poisoned,{approveBound:async()=>{}}).approve(identity(),record,{...binding,signature:"forged"}),/EVIDENCE/);}finally{Ed25519PromotionApprovalVerifier.prototype.verify=original;}
});

test("enforcement middleware rejects unnamed and drifted decisions and durably audits bound decisions",async()=>{const audits=[];const verifier={verify:async()=>identity()};const request={tenantId:"tenant-a",repositoryId:"repo-a",action:"promotion.authorize",policyEpoch:"epoch-1",correlationId:"corr"};
 const good={schema:"agentics.governance-decision/v1",allowed:true,action:request.action,tenantId:request.tenantId,repositoryId:request.repositoryId,policyEpoch:request.policyEpoch,decisionDigest:"ab".repeat(32),evidenceDigest:"cd".repeat(32),reason:"allowed"};
 await new GovernanceEnforcementMiddleware(verifier,{decide:async()=>good},{append:async value=>audits.push(value)}).authorize("jwt",request,"api");assert.equal(audits.length,1);
 await assert.rejects(new GovernanceEnforcementMiddleware(verifier,{decide:async()=>({...good,action:"cycle.read"})},{append:async()=>{}}).authorize("jwt",request,"api"),/BINDING/);
 await assert.rejects(new GovernanceEnforcementMiddleware(verifier,{decide:async()=>good},{append:async()=>{}}).authorize("jwt",{...request,action:"unnamed"},"api"),/UNKNOWN/);
});

test("delegation resolution invalidates descendants when any ancestor expires, is revoked, or changes epoch",async()=>{const base=[{id:"child",parentId:"parent",envelope:envelope({depth:2}),revoked:false,policyEpoch:"epoch-1"},{id:"parent",parentId:null,envelope:envelope(),revoked:false,policyEpoch:"epoch-1"}];
 const resolve=items=>new DelegationChainResolver({load:async(_tenant,id)=>items.find(item=>item.id===id)??null}).resolve("tenant-a","child","epoch-1","2029-01-01T00:00:00Z");assert.equal((await resolve(base)).length,2);
 await assert.rejects(resolve(base.map(item=>item.id==="parent"?{...item,revoked:true}:item)),/ANCESTOR/);
 await assert.rejects(resolve(base.map(item=>item.id==="parent"?{...item,policyEpoch:"epoch-0"}:item)),/ANCESTOR/);
 await assert.rejects(resolve(base.map(item=>item.id==="parent"?{...item,envelope:envelope({expiresAt:"2028-01-01T00:00:00Z"})}:item)),/ANCESTOR/);
});
