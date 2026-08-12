import assert from "node:assert/strict";
import { generateKeyPairSync,randomUUID,sign } from "node:crypto";
import test from "node:test";
import { tenantId, repositoryId } from "../dist/index.js";
import { deletionTombstone } from "../dist/contexts/governance/application/privacy-boundaries.js";
import { Ed25519DeletionReceiptSigner, Ed25519DeletionReceiptVerifier } from "../dist/infrastructure/governance/ed25519-deletion-receipts.js";
import { PostgresDeletionWorkflow } from "../dist/infrastructure/governance/postgres-deletion-workflow.js";
import { PostgresPersistence } from "../dist/persistence/postgres.js";
import {canonicalJson}from"../dist/shared-kernel/immutable.js";import{digestBytes}from"../dist/index.js";import{VerifiedDeletionAuthority}from"../dist/contexts/governance/application/deletion-authorization.js";import{Ed25519DeletionApprovalEvidenceVerifier}from"../dist/infrastructure/governance/ed25519-deletion-approval-verifier.js";

test("live PG tombstone blocks writes and deletion resumes idempotently to a signed receipt", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const database = new PostgresPersistence({ connectionString: process.env.TEST_DATABASE_URL, maxConnections: 8, statementTimeoutMs: 10_000, lockTimeoutMs: 5_000, enforceRuntimeRole: false });
  const suffix = `${process.pid}-${Date.now()}`; const tenant = tenantId(`privacy-${suffix}`); const repo = repositoryId("repo-a"); const calls = new Map();
  const categories = ["DATABASE", "ARTIFACT", "EVENT", "CACHE", "VECTOR", "KEY", "BACKUP_OBLIGATION"];
  const acknowledgements = new Map(); const boundaries = categories.map(category => ({ category, delete: async (tombstone, operationKey) => { calls.set(category, (calls.get(category) ?? 0) + 1);
    if (acknowledgements.has(operationKey)) return acknowledgements.get(operationKey); const result = { category, operationKey, tenantId:tombstone.tenantId,repositoryId:tombstone.repositoryId,requestId:tombstone.requestId,removed:category === "BACKUP_OBLIGATION"?0:1,
      retained:category === "BACKUP_OBLIGATION"?1:0,held:0,digest:"a".repeat(64),acknowledgementDigest:Buffer.from(operationKey).toString("hex").padEnd(64,"0").slice(0,64) }; acknowledgements.set(operationKey,result); return result; },
    verify: async result => acknowledgements.get(result.operationKey)?.acknowledgementDigest === result.acknowledgementDigest }));
  const pair = generateKeyPairSync("ed25519"); const signer = new Ed25519DeletionReceiptSigner("delete/1", pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  const approval=new VerifiedDeletionAuthority(new Set(["deleters"]),new Ed25519DeletionApprovalEvidenceVerifier({"delete/1":pair.publicKey.export({type:"spki",format:"pem"})}));const authorize=t=>{const base={schema:"agentics.deletion-approval/v1",keyId:"delete/1",decisionId:randomUUID(),evidenceDigest:"ab".repeat(32),policyEpoch:t.policyEpoch,action:"repository.delete",tenantId:t.tenantId,repositoryId:t.repositoryId,requestId:t.requestId,approverSubject:"issuer#bob",expiresAt:"2030-01-01T00:00:00Z",irreversible:true},binding={schema:base.schema,decisionId:base.decisionId,evidenceDigest:base.evidenceDigest,policyEpoch:base.policyEpoch,action:base.action,tenantId:base.tenantId,repositoryId:base.repositoryId,requestId:base.requestId,approverSubject:base.approverSubject,expiresAt:base.expiresAt,irreversible:base.irreversible},payload={...base,decisionDigest:digestBytes(new TextEncoder().encode(canonicalJson(binding)))};return approval.authorize({kind:"HUMAN",subject:"bob",issuer:"issuer",tenantId:tenant,audience:"api",groups:["deleters"],serviceAccount:null,mfa:true,expiresAt:"2030-01-01T00:00:00Z"},t,{...payload,signature:sign(null,Buffer.from(canonicalJson(payload)),pair.privateKey).toString("base64url")});};
  const workflow = new PostgresDeletionWorkflow(database, boundaries, signer, () => new Date("2027-01-02T00:00:00Z"));
  const tombstone = deletionTombstone({ tenantId: tenant, repositoryId: repo, requestId: `delete-${suffix}`, requestedAt: "2027-01-01T00:00:00Z", policyEpoch: 1 });
  try {
    await workflow.assertWritesAllowed(tenant, repo);await assert.rejects(workflow.request(tombstone),/VERIFIED_DELETION/); await workflow.request(authorize(tombstone)); await assert.rejects(workflow.assertWritesAllowed(tenant, repo), /TOMBSTONED/);
    await workflow.request(authorize(tombstone));const resume={tenantId:tenant,repositoryId:repo,requestId:tombstone.requestId};
    const saved=await database.tenantTransaction(tenant,"READ COMMITTED",async client=>(await client.query("SELECT approval_binding FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2",[tenant,repo])).rows[0].approval_binding);await database.tenantTransaction(tenant,"READ COMMITTED",client=>client.query("UPDATE governance_deletion_tombstones SET approval_binding=jsonb_set(approval_binding,'{requestId}','\"tampered-request\"') WHERE tenant_id=$1 AND repository_id=$2",[tenant,repo]));await assert.rejects(workflow.resume(resume),/PERSISTED_DELETION_APPROVAL_INVALID/);await database.tenantTransaction(tenant,"READ COMMITTED",client=>client.query("UPDATE governance_deletion_tombstones SET approval_binding=$3 WHERE tenant_id=$1 AND repository_id=$2",[tenant,repo,saved]));
    const concurrent = await Promise.all(Array.from({length:100},()=>workflow.resume(resume))); const first=concurrent[0]; for(const receipt of concurrent)assert.deepEqual(receipt,first); const second = await workflow.resume(resume); assert.deepEqual(second, first);
    await assert.rejects(workflow.resume({...resume,requestId:`attacker-${suffix}`}),/NOT_FOUND/);
    for (const category of categories) assert.ok(calls.get(category) >= 1); assert.equal(first.payload.results.length, 7);
    assert.equal(new Ed25519DeletionReceiptVerifier({ "delete/1": pair.publicKey.export({ type: "spki", format: "pem" }) }).verify(first), true);
    const conflict={...tombstone,requestId:`conflict-${suffix}`};await assert.rejects(workflow.request(authorize(conflict)), /TOMBSTONE_CONFLICT/);
    const rows = await database.tenantTransaction(tenant, "READ COMMITTED", client => client.query("SELECT state FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2", [tenant,repo])); assert.equal(rows.rows[0].state, "COMPLETED");
  } finally { await database.close(); }
});
