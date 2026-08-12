import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { tenantId, repositoryId } from "../dist/index.js";
import { deletionTombstone } from "../dist/contexts/governance/application/privacy-boundaries.js";
import { Ed25519DeletionReceiptSigner, Ed25519DeletionReceiptVerifier } from "../dist/infrastructure/governance/ed25519-deletion-receipts.js";
import { PostgresDeletionWorkflow } from "../dist/infrastructure/governance/postgres-deletion-workflow.js";
import { PostgresPersistence } from "../dist/persistence/postgres.js";

test("live PG tombstone blocks writes and deletion resumes idempotently to a signed receipt", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const database = new PostgresPersistence({ connectionString: process.env.TEST_DATABASE_URL, maxConnections: 8, statementTimeoutMs: 10_000, lockTimeoutMs: 5_000, enforceRuntimeRole: false });
  const suffix = `${process.pid}-${Date.now()}`; const tenant = tenantId(`privacy-${suffix}`); const repo = repositoryId("repo-a"); const calls = new Map();
  const categories = ["DATABASE", "ARTIFACT", "EVENT", "CACHE", "VECTOR", "KEY", "BACKUP_OBLIGATION"];
  const boundaries = categories.map(category => ({ category, delete: async tombstone => { calls.set(category, (calls.get(category) ?? 0) + 1); return { category, removed: category === "BACKUP_OBLIGATION" ? 0 : 1,
    retained: category === "BACKUP_OBLIGATION" ? 1 : 0, held: 0, digest: Buffer.from(`${tombstone.requestId}/${category}`).toString("hex").padEnd(64,"0").slice(0,64) }; } }));
  const pair = generateKeyPairSync("ed25519"); const signer = new Ed25519DeletionReceiptSigner("delete/1", pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  const workflow = new PostgresDeletionWorkflow(database, boundaries, signer, () => new Date("2027-01-02T00:00:00Z"));
  const tombstone = deletionTombstone({ tenantId: tenant, repositoryId: repo, requestId: `delete-${suffix}`, requestedAt: "2027-01-01T00:00:00Z", policyEpoch: 1 });
  try {
    await workflow.assertWritesAllowed(tenant, repo); await workflow.request(tombstone); await assert.rejects(workflow.assertWritesAllowed(tenant, repo), /TOMBSTONED/);
    await workflow.request(tombstone); const first = await workflow.resume(tombstone); const second = await workflow.resume(tombstone); assert.deepEqual(second, first);
    for (const category of categories) assert.equal(calls.get(category), 1); assert.equal(first.payload.results.length, 7);
    assert.equal(new Ed25519DeletionReceiptVerifier({ "delete/1": pair.publicKey.export({ type: "spki", format: "pem" }) }).verify(first), true);
    await assert.rejects(workflow.request({ ...tombstone, requestId: `conflict-${suffix}` }), /TOMBSTONE_CONFLICT/);
    const rows = await database.tenantTransaction(tenant, "READ COMMITTED", client => client.query("SELECT state FROM governance_deletion_tombstones WHERE tenant_id=$1 AND repository_id=$2", [tenant,repo])); assert.equal(rows.rows[0].state, "COMPLETED");
  } finally { await database.close(); }
});
