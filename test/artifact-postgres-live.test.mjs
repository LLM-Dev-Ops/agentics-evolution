import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { actorId, digestBytes, digestReference, repositoryId, sourceSnapshot, tenantId } from "../dist/index.js";
import { stagedManifest } from "../dist/contexts/artifact-lineage/domain/artifact-manifest.js";
import { LocalContentAddressedStorage } from "../dist/contexts/artifact-lineage/infrastructure/local-cas.js";
import { ArtifactLineageStore } from "../dist/infrastructure/artifact-lineage/lineage-store.js";
import { HmacArtifactAccessAuthority } from "../dist/infrastructure/artifact-lineage/hmac-artifact-access.js";
import { PostgresPersistence } from "../dist/persistence/postgres.js";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL_REQUIRED_FOR_ARTIFACT_POSTGRES_LIVE");
const reference = (bytes) => { const sha256 = digestBytes(bytes); return digestReference({ uri: `cas://sha256/${sha256}`, sha256 }); };

test("live PG publication, global references, legal holds, GC and stale-intent reconciliation", async () => {
  const suffix = `${process.pid}-${Date.now()}`; const tenantA = tenantId(`live-a-${suffix}`); const tenantB = tenantId(`live-b-${suffix}`);
  const repoA = repositoryId("repo-a"); const repoB = repositoryId("repo-b"); const root = await mkdtemp(join(tmpdir(), "artifact-pg-live-"));
  const database = new PostgresPersistence({ connectionString: process.env.TEST_DATABASE_URL, maxConnections: 12, statementTimeoutMs: 10_000, lockTimeoutMs: 5_000, enforceRuntimeRole: false });
  const access = new HmacArtifactAccessAuthority(Buffer.alloc(32, 23)); const cas = new LocalContentAddressedStorage(root, undefined, access);
  let holdAction = "PLACE"; let holdDigest = ""; let nonce = 0;
  const holdVerifier = { verify: async () => ({ tenantId: tenantA, manifestDigest: holdDigest, action: holdAction, actor: "governance",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: `live-hold-${++nonce}` }) };
  const storeA = new ArtifactLineageStore(database, cas, access, holdVerifier); const storeB = new ArtifactLineageStore(database, cas, access);
  const publish = async (store, tenant, repository, bytes, label) => {
    const artifact = reference(bytes); const metadata = { tenantId: tenant, repositoryId: repository, mediaType: "application/octet-stream",
      classification: "CONFIDENTIAL", retention: "OPERATIONAL_SCRATCH", legalHold: false };
    const staged = await cas.stage(bytes, artifact, metadata); const manifest = stagedManifest({ schema: "agentics.artifact-manifest/v1", tenantId: tenant,
      repositoryId: repository, artifact, mediaType: metadata.mediaType, size: bytes.byteLength, producer: actorId("integration"),
      source: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }), dependencies: [], classification: metadata.classification,
      retention: metadata.retention, createdAt: "2020-01-01T00:00:00.000Z", rvfWitness: null });
    await store.publishStaged(manifest, staged); return manifest;
  };
  const expire = async (tenant, digest) => database.tenantTransaction(tenant, "SERIALIZABLE", (client) => client.query(
    "UPDATE artifact_manifests SET status='EXPIRED',retain_until='2020-01-01',updated_at='2020-01-01',version=version+1 WHERE tenant_id=$1 AND manifest_digest=$2",
    [tenant, digest]).then(() => undefined));
  try {
    const shared = Buffer.from("identical-global-bytes"); const manifestA = await publish(storeA, tenantA, repoA, shared, "a");
    const manifestB = await publish(storeB, tenantB, repoB, shared, "b"); assert.equal(manifestA.payload.artifact.sha256, manifestB.payload.artifact.sha256);
    await expire(tenantA, manifestA.manifestDigest.sha256); await expire(tenantB, manifestB.manifestDigest.sha256);

    holdDigest = manifestA.manifestDigest.sha256; await storeA.setLegalHold(tenantA, holdDigest, true, { receipt: "opaque-signed-by-fixture-verifier" });
    assert.deepEqual(await storeA.garbageCollect(tenantA, "gc-live", new Date("2030-01-01")), { marked: 0, swept: 0 });
    holdAction = "RELEASE"; await storeA.setLegalHold(tenantA, holdDigest, false, { receipt: "opaque-signed-by-fixture-verifier" });
    const blocked = await storeA.garbageCollect(tenantA, "gc-live", new Date("2030-01-01")); assert.equal(blocked.swept, 0);
    assert.equal(await cas.exists(manifestA.payload.artifact), true, "tenant B live reference blocks tenant A GC");

    await database.tenantTransaction(tenantA, "SERIALIZABLE", (client) => client.query(
      "UPDATE artifact_digest_references SET live=false,released_at=transaction_timestamp() WHERE tenant_id=$1 AND manifest_digest=$2",
      [tenantA, manifestA.manifestDigest.sha256]).then(() => undefined));
    const deleted = await storeB.garbageCollect(tenantB, "gc-live", new Date("2030-01-01")); assert.equal(deleted.swept, 1);
    assert.equal(await cas.exists(manifestB.payload.artifact), false, "physical bytes delete only after all other live references release");

    const recovery = await publish(storeA, tenantA, repoA, Buffer.from("pending-intent"), "recovery"); await expire(tenantA, recovery.manifestDigest.sha256);
    const runId = randomUUID(); await database.tenantTransaction(tenantA, "SERIALIZABLE", async (client) => {
      await client.query("INSERT INTO artifact_gc_runs(tenant_id,run_id,cutoff,status) VALUES($1,$2,'2020-01-01','SWEEPING')", [tenantA, runId]);
      await client.query(`INSERT INTO artifact_gc_candidates(tenant_id,run_id,manifest_digest,expected_version,intent_id,intent_fence,intent_expires_at)
        SELECT $1,$2,manifest_digest,version,$3,1,'2020-01-01' FROM artifact_manifests WHERE tenant_id=$1 AND manifest_digest=$4`,
        [tenantA, runId, randomUUID(), recovery.manifestDigest.sha256]);
    });
    const reconciled = await storeA.reconcilePendingGcIntents(tenantA, "reconciler", new Date("2030-01-01")); assert.ok(reconciled.swept >= 1);
    const audit = await database.tenantTransaction(tenantA, "READ COMMITTED", (client) => client.query(
      "SELECT status FROM artifact_gc_runs WHERE tenant_id=$1 AND run_id=$2", [tenantA, runId]));
    assert.equal(audit.rows[0].status, "ABORTED"); assert.equal(await cas.exists(recovery.payload.artifact), false);
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
});
