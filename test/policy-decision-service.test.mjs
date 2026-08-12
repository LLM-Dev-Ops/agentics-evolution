import assert from "node:assert/strict";
import test from "node:test";
import { PolicyDecisionService } from "../dist/contexts/governance/application/policy-decision-service.js";
import { repositoryId, tenantId } from "../dist/index.js";

const actions=["cycle.read","cycle.run","candidate.generate","candidate.evaluate","evidence.reset","promotion.qualify","promotion.authorize","rollout.start","rollout.rollback","repository.write","release.publish"];
const scope=action=>({tenantId:tenantId("tenant-a"),repositoryId:repositoryId("repo-a"),action,actorId:"actor",policyEpoch:7});
const approval=action=>({action,tenantId:"tenant-a",repositoryId:"repo-a",policyEpoch:7,expiresAt:new Date(Date.now()+60_000).toISOString(),revoked:false,usesRemaining:1});
const service=(outcome="ALLOW",allowed=true,epoch=7)=>new PolicyDecisionService({evaluate:async()=>({outcome,decisionId:"p",decisionDigest:"a".repeat(64),matchedPolicies:[],matchedRules:[]})},{enforce:async()=>({allowed,decisionId:"e",reasonCode:null})},async()=>epoch);

test("all 11 governance actions obey allow/default-deny/deny-override and approval truth table",async()=>{
  for(const action of actions){const needs=["evidence.reset","promotion.authorize","rollout.start","rollout.rollback","repository.write","release.publish"].includes(action);
    assert.equal((await service().decide(scope(action),{},needs?approval(action):undefined,new AbortController().signal)).allowed,true,action);
    assert.equal((await service("DENY").decide(scope(action),{},approval(action),new AbortController().signal)).allowed,false,`${action}: deny`);
    assert.equal((await service("WARN").decide(scope(action),{},approval(action),new AbortController().signal)).reason,"DEFAULT_DENY");
    assert.equal((await service("ALLOW",false).decide(scope(action),{},approval(action),new AbortController().signal)).allowed,false);
    if(needs)assert.equal((await service().decide(scope(action),{},undefined,new AbortController().signal)).reason,"BOUNDED_APPROVAL_REQUIRED");
  }
});
test("approval scope/revocation/expiry/use and policy epoch fail closed",async()=>{const s=scope("release.publish");for(const bad of [{...approval(s.action),revoked:true},{...approval(s.action),usesRemaining:0},{...approval(s.action),expiresAt:"2020-01-01T00:00:00Z"},{...approval(s.action),repositoryId:"repo-b"}])assert.equal((await service().decide(s,{},bad,new AbortController().signal)).allowed,false);assert.equal((await service("ALLOW",true,8).decide(s,{},approval(s.action),new AbortController().signal)).reason,"POLICY_EPOCH_STALE");});
test("authority outage exposes read status but blocks every mutation",async()=>{const unavailable=new PolicyDecisionService({evaluate:async()=>{throw new Error("down");}},{enforce:async()=>{throw new Error("down");}},async()=>7);for(const action of actions){const result=await unavailable.decide(scope(action),{},approval(action),new AbortController().signal);assert.equal(result.allowed,action==="cycle.read");assert.equal(result.observableOnly,action==="cycle.read");}});
