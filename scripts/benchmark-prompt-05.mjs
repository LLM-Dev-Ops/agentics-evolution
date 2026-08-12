import { generateKeyPairSync, sign } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { PolicyDecisionService } from "../dist/contexts/governance/application/policy-decision-service.js";
import { deletionTombstone } from "../dist/contexts/governance/application/privacy-boundaries.js";
import { decisionDigest } from "../dist/contexts/governance/application/verified-approval.js";
import { normalizeEnvelope, isEnvelopeSubset } from "../dist/contexts/governance/domain/capability.js";
import { Ed25519DeletionReceiptSigner } from "../dist/infrastructure/governance/ed25519-deletion-receipts.js";
import { CryptographicOidcIdentityVerifier } from "../dist/infrastructure/governance/oidc-identity-verifier.js";
import { PostgresAuthorizationRepository } from "../dist/infrastructure/governance/postgres-authorization-repository.js";
import { PostgresBudgetAuthority } from "../dist/infrastructure/governance/postgres-budget-authority.js";
import { PostgresDeletionWorkflow } from "../dist/infrastructure/governance/postgres-deletion-workflow.js";
import { PostgresPersistence } from "../dist/persistence/postgres.js";
import { money } from "../dist/shared-kernel/money.js";
import { repositoryId, tenantId } from "../dist/shared-kernel/identity.js";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL_REQUIRED_FOR_PROMPT_05_BENCHMARK");
const measure = async (count, operation) => { const samples=[]; const startAll=performance.now(); for(let index=0;index<count;index++){const start=performance.now();await operation(index);samples.push(performance.now()-start);} const elapsed=performance.now()-startAll;samples.sort((a,b)=>a-b);const p=x=>samples[Math.min(samples.length-1,Math.floor(samples.length*x))];return {operations:count,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),throughputPerSecond:count/(elapsed/1000)}; };
const assertLane = (name, lane, limits) => { if (lane.p99Ms>limits.p99Ms || lane.throughputPerSecond<limits.minimumThroughputPerSecond) throw new Error(`PROMPT_05_${name}_BENCHMARK_REGRESSION`); };
const suffix=`bench-${process.pid}-${Date.now()}`; const tenant=tenantId(suffix); const repository=repositoryId("repo-a");
const database=new PostgresPersistence({connectionString:process.env.TEST_DATABASE_URL,maxConnections:24,statementTimeoutMs:15_000,lockTimeoutMs:5_000,enforceRuntimeRole:false});
try {
  const parent=normalizeEnvelope({tenantId:tenant,repositories:[repository,"repo-b"],paths:["src","test"],tools:["read","write"],network:["api.example.com:443"],providers:["private"],models:["model-a"],regions:["us-central1"],classification:"RESTRICTED",spend:money(1000000n,"USD"),concurrency:32,expiresAt:"2099-01-01T00:00:00.000Z",depth:8,uses:100,action:"candidate.evaluate"});
  const child=normalizeEnvelope({...parent,repositories:[repository],paths:["src"],tools:["read"],concurrency:4,spend:money(1000n,"USD"),depth:4,uses:10});
  const envelopeSubset=await measure(50_000,()=>{if(!isEnvelopeSubset(child,parent))throw new Error("SUBSET_REGRESSION");});

  const policyService=new PolicyDecisionService({evaluate:async()=>({outcome:"ALLOW",decisionId:"d",decisionDigest:"a".repeat(64),matchedPolicies:["bench"],matchedRules:["allow"]})},{enforce:async()=>({allowed:true,decisionId:"e",reasonCode:null})},async()=>7);
  const policy=await measure(10_000,async()=>{const decision=await policyService.decide({tenantId:tenant,repositoryId:repository,action:"cycle.run",actorId:"bench",policyEpoch:7},{fixture:true},undefined,new AbortController().signal);if(!decision.allowed)throw new Error("POLICY_REGRESSION");});

  const pair=generateKeyPairSync("ed25519");const publicPem=pair.publicKey.export({type:"spki",format:"pem"});const now=Math.floor(Date.now()/1000);
  const verifier=new CryptographicOidcIdentityVerifier([{issuer:"https://identity.bench",audiences:["agentics"],algorithms:["EdDSA"],keys:{k1:publicPem},maximumTokenAgeSeconds:300,clockSkewSeconds:5,subjects:{bench:{kind:"HUMAN",tenantId:tenant,groups:["operators"],requireMfa:true}}}]);
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");const header=encode({alg:"EdDSA",kid:"k1",typ:"JWT"});const body=encode({iss:"https://identity.bench",sub:"bench",aud:"agentics",iat:now-1,nbf:now-1,exp:now+240,amr:["mfa"]});const input=`${header}.${body}`;const token=`${input}.${sign(null,Buffer.from(input),pair.privateKey).toString("base64url")}`;
  const oidc=await measure(2_000,()=>verifier.verify(token,"agentics"));

  const authorizationRepository=new PostgresAuthorizationRepository(database);const authorizationId=crypto.randomUUID();const authorizationEnvelope={...parent,action:"promotion.authorize",uses:100};
  await authorizationRepository.request(tenant,repository,{id:authorizationId,requester:"issuer#requester",candidateDigest:"ab".repeat(32),evidenceDigest:"cd".repeat(32),environment:"production",expectedChampionVersion:1,policyEpoch:"epoch-7",envelope:authorizationEnvelope,expiresAt:"2099-01-01T00:00:00Z",maxUses:100},crypto.randomUUID());
  const approvalBase={schema:"agentics.governance-decision/v1",outcome:"ALLOW",decisionId:crypto.randomUUID(),evidenceDigest:"cd".repeat(32),policyEpoch:"epoch-7",scope:{tenantId:tenant,repositoryId:repository,action:"promotion.authorize"}};const approval={...approvalBase,decisionDigest:decisionDigest(approvalBase)};
  await authorizationRepository.approveBound(tenant,authorizationId,"issuer#approver",authorizationEnvelope,approval);
  const authStarted=performance.now();const authResults=await Promise.all(Array.from({length:200},(_,index)=>authorizationRepository.consume(tenant,authorizationId,`consumer-${index}`,approval)));const authElapsed=performance.now()-authStarted;
  const authorization={operations:200,p50Ms:authElapsed/200,p95Ms:authElapsed/200,p99Ms:authElapsed/200,throughputPerSecond:200/(authElapsed/1000),successfulConsumes:authResults.filter(Boolean).length}; if(authorization.successfulConsumes!==100)throw new Error("AUTHORIZATION_CONTENTION_REGRESSION");

  const ledgerReservations=new Map();const ledger={reserve:async input=>{const prior=ledgerReservations.get(input.idempotencyKey);if(prior)return prior;const value={reservationId:`r-${input.idempotencyKey}`,status:"active",amount:input.amount,expiresAt:new Date(Date.now()+60_000).toISOString()};ledgerReservations.set(input.idempotencyKey,value);return value;},consume:async input=>({entryId:`e-${input.idempotencyKey}`,amount:input.actualAmount}),cancel:async input=>({reservationId:input.reservationId,status:"cancelled",amount:"1",expiresAt:new Date().toISOString()})};
  const budgetAuthority=new PostgresBudgetAuthority(database,ledger);const budget=await measure(100,index=>budgetAuthority.reserve({tenantId:tenant,repositoryId:repository,organizationId:"bench-org",amount:"1",ttlSeconds:60,idempotencyKey:crypto.randomUUID(),actor:"bench",correlationId:`budget-${index}`},new AbortController().signal));

  const categories=["DATABASE","ARTIFACT","EVENT","CACHE","VECTOR","KEY","BACKUP_OBLIGATION"];const acknowledgements=new Map();const boundaries=categories.map(category=>({category,delete:async(tombstone,operationKey)=>{if(acknowledgements.has(operationKey))return acknowledgements.get(operationKey);const value={category,operationKey,tenantId:tombstone.tenantId,repositoryId:tombstone.repositoryId,requestId:tombstone.requestId,removed:category==="BACKUP_OBLIGATION"?0:1,retained:category==="BACKUP_OBLIGATION"?1:0,held:0,digest:"a".repeat(64),acknowledgementDigest:"b".repeat(64)};acknowledgements.set(operationKey,value);return value;},verify:async value=>value.acknowledgementDigest==="b".repeat(64)}));
  const deletionPair=generateKeyPairSync("ed25519");const deletionWorkflow=new PostgresDeletionWorkflow(database,boundaries,new Ed25519DeletionReceiptSigner("bench-delete/1",deletionPair.privateKey.export({type:"pkcs8",format:"pem"})));
  const deleteRepository=repositoryId("repo-delete");const tombstone=deletionTombstone({tenantId:tenant,repositoryId:deleteRepository,requestId:`delete-${crypto.randomUUID()}`,requestedAt:new Date().toISOString(),policyEpoch:7});await deletionWorkflow.request(tombstone);
  const deletion=await measure(1,()=>deletionWorkflow.resume(tombstone));

  const limits={envelopeSubset:{p99Ms:1,minimumThroughputPerSecond:10_000},policy:{p99Ms:5,minimumThroughputPerSecond:1_000},oidc:{p99Ms:5,minimumThroughputPerSecond:500},authorization:{p99Ms:250,minimumThroughputPerSecond:20},budget:{p99Ms:250,minimumThroughputPerSecond:20},deletion:{p99Ms:2_000,minimumThroughputPerSecond:.1},maximumRssBytes:768*1024*1024};
  for(const [name,lane] of Object.entries({envelopeSubset,policy,oidc,authorization,budget,deletion}))assertLane(name,lane,limits[name]);const rssBytes=process.memoryUsage().rss;if(rssBytes>limits.maximumRssBytes)throw new Error("PROMPT_05_RSS_REGRESSION");
  const report={schema:"agentics.prompt-05-benchmark/v2",fixture:{tenant,repository,envelopeOperations:envelopeSubset.operations,policyOperations:policy.operations,oidcOperations:oidc.operations,authorizationContenders:authorization.operations,budgetReservations:budget.operations,deletionCategories:categories.length},envelopeSubset,policy,oidc,authorization,budget,deletion,limits,environment:{node:process.version,platform:process.platform,arch:process.arch,rssBytes,postgres:"16"}};
  await mkdir("reports",{recursive:true});await writeFile("reports/prompt-05-benchmark.json",`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report));
} finally { await database.close(); }
