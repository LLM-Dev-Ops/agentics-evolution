import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReceipt } from "@metaharness/flywheel";
import { actorId, digestBytes, digestReference, repositoryId, sourceSnapshot, tenantId } from "../dist/index.js";
import { stagedManifest, canonicalManifestBytes, sealedManifest } from "../dist/contexts/artifact-lineage/domain/artifact-manifest.js";
import { artifactReadGrant } from "../dist/contexts/artifact-lineage/application/cas-port.js";
import { LocalContentAddressedStorage } from "../dist/contexts/artifact-lineage/infrastructure/local-cas.js";
import { LocalFlywheelSigner } from "../dist/infrastructure/upstream-flywheel/artifact-signer.js";
import { ArtifactLineageStore } from "../dist/infrastructure/artifact-lineage/lineage-store.js";
import { PostgresPersistence } from "../dist/index.js";

const reference = (bytes) => { const sha256 = digestBytes(bytes); return digestReference({ uri: `cas://sha256/${sha256}`, sha256 }); };
const metadata = (tenant = "tenant-a") => ({ tenantId: tenantId(tenant), repositoryId: repositoryId("repo-a"), mediaType: "application/octet-stream",
  classification: "CONFIDENTIAL", retention: "EVALUATION_EVIDENCE", legalHold: false });

test("local CAS stages, atomically finalizes, deduplicates and isolates tenants", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentics-cas-")); const cas = new LocalContentAddressedStorage(root, 1024); const bytes = new TextEncoder().encode("artifact"); const expected = reference(bytes);
  try {
    await assert.rejects(cas.stage(bytes, reference(new TextEncoder().encode("other")), metadata()), /DIGEST_MISMATCH/);
    const staged = await cas.stage(bytes, expected, metadata()); await cas.finalize(staged); assert.deepEqual([...await cas.read(expected, artifactReadGrant(tenantId("tenant-a"), repositoryId("repo-a")))], [...bytes]);
    await assert.rejects(cas.read(expected, artifactReadGrant(tenantId("tenant-b"), repositoryId("repo-a"))), /NOT_FOUND/);
    const duplicate = await cas.stage(bytes, expected, metadata()); await cas.finalize(duplicate); assert.deepEqual([...await cas.read(expected, artifactReadGrant(tenantId("tenant-a"), repositoryId("repo-a")))], [...bytes]);
    const tampered = await cas.stage(bytes, expected, metadata()); await writeFile(join(root, "staging", tampered.stageId), "tampered");
    await assert.rejects(cas.finalize(tampered), /TAMPERED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ordered manifest digest and exact Flywheel signer remain upstream compatible", () => {
  const bytes = new TextEncoder().encode("artifact"); const artifact = reference(bytes); const dependencyA = reference(new TextEncoder().encode("a")); const dependencyB = reference(new TextEncoder().encode("b"));
  const payload = { schema: "agentics.artifact-manifest/v1", tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), artifact,
    mediaType: "application/octet-stream", size: bytes.byteLength, producer: actorId("producer-a"), source: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }),
    dependencies: [{ digest: dependencyA, role: "input" }, { digest: dependencyB, role: "output" }], classification: "CONFIDENTIAL", retention: "EVALUATION_EVIDENCE",
    createdAt: "2026-08-12T00:00:00.000Z", rvfWitness: null };
  const staged = stagedManifest(payload); const reordered = stagedManifest({ ...payload, dependencies: [...payload.dependencies].reverse() }); assert.notEqual(staged.manifestDigest.sha256, reordered.manifestDigest.sha256);
  assert.equal(digestBytes(canonicalManifestBytes(payload)), staged.manifestDigest.sha256);
  const { privateKey } = generateKeyPairSync("ed25519"); const signer = new LocalFlywheelSigner(privateKey.export({ type: "pkcs8", format: "pem" }));
  const receipt = signer.sign({ manifestDigest: staged.manifestDigest.sha256, purpose: "CYCLE_WITNESS" }); assert.equal(verifyReceipt(receipt), true);
  assert.equal(verifyReceipt({ ...receipt, payload: { ...receipt.payload, purpose: "RELEASE_PROVENANCE" } }), false);
  assert.equal(sealedManifest(staged, "dev-key/1", receipt.signature).status, "SEALED");
});

test("PostgreSQL lineage seals dependencies, audits holds and fences garbage collection", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const root = await mkdtemp(join(tmpdir(), "agentics-lineage-")); const cas = new LocalContentAddressedStorage(root); const tenant = tenantId(`artifact-${process.pid}-${Date.now()}`);
  const database = new PostgresPersistence({ connectionString: process.env.TEST_DATABASE_URL, maxConnections: 8, statementTimeoutMs: 5_000, lockTimeoutMs: 1_000, enforceRuntimeRole: false });
  let holdAction = "PLACE"; let nonce = 0; const holdVerifier = { verify: async () => ({ tenantId: tenant, manifestDigest: orphan?.manifestDigest.sha256 ?? "", action: holdAction,
    actor: "governance", expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: `hold-${++nonce}` }) };
  const lineage = new ArtifactLineageStore(database, cas, holdVerifier); let orphan; const create = async (label, dependencies = []) => {
    const bytes = new TextEncoder().encode(label); const artifact = reference(bytes); const staged = await cas.stage(bytes, artifact, metadata(tenant)); await cas.finalize(staged);
    const payload = { schema: "agentics.artifact-manifest/v1", tenantId: tenant, repositoryId: repositoryId("repo-a"), artifact,
      mediaType: "application/octet-stream", size: bytes.byteLength, producer: actorId("producer-a"), source: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }),
      dependencies, classification: "CONFIDENTIAL", retention: "OPERATIONAL_SCRATCH", createdAt: "2020-01-01T00:00:00.000Z", rvfWitness: null };
    const manifest = stagedManifest(payload); await lineage.stage(manifest); const sealed = sealedManifest(manifest, "dev-key/1", "signature"); await lineage.seal(sealed); return sealed;
  };
  try {
    const leaf = await create("leaf"); const parent = await create("parent", [{ digest: leaf.payload.artifact, role: "input" }]); orphan = await create("orphan");
    await lineage.transitionStatus(tenant, leaf.manifestDigest.sha256, "EXPIRED", "governance", "retention elapsed");
    await lineage.setLegalHold(tenant, orphan.manifestDigest.sha256, true, { receipt: "opaque" }); await lineage.transitionStatus(tenant, orphan.manifestDigest.sha256, "EXPIRED", "governance", "retention elapsed");
    assert.deepEqual(await lineage.garbageCollect(tenant, "gc", new Date("2030-01-01T00:00:00Z")), { marked: 0, swept: 0 });
    holdAction = "RELEASE"; await lineage.setLegalHold(tenant, orphan.manifestDigest.sha256, false, { receipt: "opaque" }); const collected = await lineage.garbageCollect(tenant, "gc", new Date("2030-01-01T00:00:00Z"));
    assert.deepEqual(collected, { marked: 1, swept: 1 }); assert.equal(await cas.exists(orphan.payload.artifact), false);
    assert.equal(await cas.exists(leaf.payload.artifact), true); assert.equal(await cas.exists(parent.payload.artifact), true);
  } finally { await database.close(); await rm(root, { recursive: true, force: true }); }
});
