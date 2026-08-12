import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { actorId,aggregateId,causationId,correlationId,createEnvelope,cycleId,digestBytes,digestReference,eventId,idempotencyKey,PostgresLocalTransport,PostgresPersistence,repositoryId,sourceSnapshot,tenantId,utcInstant } from "../dist/index.js";
import { deletionTombstone } from "../dist/contexts/governance/application/privacy-boundaries.js";
import { TenantBoundaryIssuer } from "../dist/contexts/governance/application/tenant-boundaries.js";
import { serviceDeletionBoundaries,ScopedBoundaryRegistry } from "../dist/infrastructure/governance/deletion-boundaries.js";
import { Ed25519DeletionReceiptSigner } from "../dist/infrastructure/governance/ed25519-deletion-receipts.js";
import { PostgresDeletionWorkflow } from "../dist/infrastructure/governance/postgres-deletion-workflow.js";
import { OrderedEnvelopeConsumer } from "../dist/messaging/ordered-consumer.js";
const url=process.env.TEST_DATABASE_URL;
function envelope(tenant,repository,seed){const digest=digestBytes(new TextEncoder().encode(seed));return createEnvelope({envelopeSchema:"agentics.evolution-envelope/v1",schemaVersion:1,id:eventId(`0198a41d-2c00-7000-8000-${seed.padStart(12,"0")}`),type:"PrivacyFixtureCreated",tenantId:tenant,repositoryId:repository,aggregateId:aggregateId(`privacy-${seed}`),cycleId:cycleId("cycle-a"),actorId:actorId("actor-a"),occurredAt:utcInstant("2026-08-12T00:00:00.000Z"),causationId:causationId("0198a41d-2c00-7000-8000-100000000001"),correlationId:correlationId("0198a41d-2c00-7000-8000-100000000002"),idempotencyKey:idempotencyKey(`0198a41d-2c00-7000-8000-${(Number(seed)+100).toString().padStart(12,"0")}`),policyEpoch:1,sourceRef:sourceSnapshot({commit:"a".repeat(40),dirtySnapshot:null}),evidence:[digestReference({uri:`cas://sha256/${digest}`,sha256:digest})],payload:{secret:"purge-me"}});}

test("owned deletion boundaries purge projections/events/CAS refs and tombstone every ingress",{skip:!url},async()=>{
 const database=new PostgresPersistence({connectionString:url,maxConnections:12,statementTimeoutMs:10_000,lockTimeoutMs:3_000,enforceRuntimeRole:false});const suffix=`${process.pid}${Date.now()}`.slice(-10);const tenant=tenantId(`delete-boundary-${suffix}`),repo=repositoryId("repo-a"),event=envelope(tenant,repo,"41");const transport=new PostgresLocalTransport(database);
 const memory=new ScopedBoundaryRegistry();memory.add("CACHE",tenant,repo,"cached");memory.add("KEY",tenant,repo,"key-ref");
 const pair=generateKeyPairSync("ed25519");const signer=new Ed25519DeletionReceiptSigner("delete/owned-1",pair.privateKey.export({type:"pkcs8",format:"pem"}));const workflow=new PostgresDeletionWorkflow(database,serviceDeletionBoundaries(database,memory),signer);
 try{
  await database.executeCommand({aggregateType:"privacy-fixture",expectedVersion:0,state:{secret:"projection"},event,topic:"evolution.events.v1"});
  const attributes={correlationId:event.correlationId,causationId:event.causationId};await transport.publish("evolution.events.v1",{envelope:event,orderingKey:`${tenant}/${repo}/${event.aggregateId}`,attributes});
  await database.tenantTransaction(tenant,"SERIALIZABLE",async client=>{await client.query("INSERT INTO critical_resources(tenant_id,repository_id,resource_type,resource_id,remaining) VALUES($1,$2,'budget','privacy',1)",[tenant,repo]);const manifest="b".repeat(64),artifact="c".repeat(64);await client.query("INSERT INTO artifact_manifests(tenant_id,repository_id,manifest_digest,artifact_digest,payload,status,retain_until,legal_hold) VALUES($1,$2,$3,$4,'{}','REVOKED','2020-01-01',false)",[tenant,repo,manifest,artifact]);await client.query("INSERT INTO artifact_digest_references(tenant_id,repository_id,artifact_digest,manifest_digest) VALUES($1,$2,$3,$4)",[tenant,repo,artifact,manifest]);});
  const tombstone=deletionTombstone({tenantId:tenant,repositoryId:repo,requestId:`delete-${suffix}`,requestedAt:new Date().toISOString(),policyEpoch:1});await workflow.request(tombstone);const receipt=await workflow.resume(tombstone);
  assert.equal(receipt.payload.results.length,7);assert.equal(memory.size("CACHE",tenant,repo),0);assert.equal(memory.size("KEY",tenant,repo),0);
  const state=await database.tenantTransaction(tenant,"READ COMMITTED",async client=>({critical:(await client.query("SELECT count(*)::int n FROM critical_resources WHERE tenant_id=$1 AND repository_id=$2",[tenant,repo])).rows[0].n,transport:(await client.query("SELECT count(*)::int n FROM local_transport_messages WHERE tenant_id=$1 AND envelope->>'repositoryId'=$2",[tenant,repo])).rows[0].n,reference:(await client.query("SELECT live FROM artifact_digest_references WHERE tenant_id=$1 AND repository_id=$2",[tenant,repo])).rows[0].live,event:(await client.query("SELECT envelope FROM domain_events WHERE tenant_id=$1 AND repository_id=$2",[tenant,repo])).rows[0].envelope}));
  assert.deepEqual({critical:state.critical,transport:state.transport,reference:state.reference},{critical:0,transport:0,reference:false});assert.equal(state.event.deleted,true);assert.equal("payload" in state.event,false);
  await assert.rejects(database.executeCommand({aggregateType:"privacy-fixture",expectedVersion:1,state:{},event:{...event,id:eventId("0198a41d-2c00-7000-8000-000000000142"),idempotencyKey:idempotencyKey("0198a41d-2c00-7000-8000-000000000242")},topic:"evolution.events.v1"}),/TOMBSTONED/);
  await assert.rejects(transport.publish("evolution.events.v1",{envelope:{...event,id:eventId("0198a41d-2c00-7000-8000-000000000143")},orderingKey:`${tenant}/${repo}/${event.aggregateId}`,attributes}),/TOMBSTONED/);
  await assert.rejects(new OrderedEnvelopeConsumer(database,"privacy").apply({...event,id:eventId("0198a41d-2c00-7000-8000-000000000144")},2,async()=>true),/TOMBSTONED/);
  const issuer=new TenantBoundaryIssuer(workflow);await assert.rejects(issuer.cacheKey(tenant,repo,"cycle","x"),/TOMBSTONED/);await assert.rejects(issuer.vectorNamespace(tenant,repo,"brain"),/TOMBSTONED/);await assert.rejects(issuer.keyAlias(tenant,repo,"receipt"),/TOMBSTONED/);
 }finally{await database.close();}
});
