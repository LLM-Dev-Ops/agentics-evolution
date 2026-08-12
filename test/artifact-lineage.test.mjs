import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReceipt } from "@metaharness/flywheel";
import { actorId, digestBytes, digestReference, repositoryId, sourceSnapshot, tenantId } from "../dist/index.js";
import { stagedManifest, canonicalManifestBytes, sealedManifest } from "../dist/contexts/artifact-lineage/domain/artifact-manifest.js";
import { LocalContentAddressedStorage } from "../dist/contexts/artifact-lineage/infrastructure/local-cas.js";
import { LocalFlywheelSigner } from "../dist/infrastructure/upstream-flywheel/artifact-signer.js";

const reference = (bytes) => { const sha256 = digestBytes(bytes); return digestReference({ uri: `cas://sha256/${sha256}`, sha256 }); };
const metadata = (tenant = "tenant-a") => ({ tenantId: tenantId(tenant), repositoryId: repositoryId("repo-a"), mediaType: "application/octet-stream",
  classification: "CONFIDENTIAL", retention: "EVALUATION_EVIDENCE", legalHold: false });

test("local CAS stages, atomically finalizes, deduplicates and isolates tenants", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentics-cas-")); const cas = new LocalContentAddressedStorage(root, 1024); const bytes = new TextEncoder().encode("artifact"); const expected = reference(bytes);
  try {
    await assert.rejects(cas.stage(bytes, reference(new TextEncoder().encode("other")), metadata()), /DIGEST_MISMATCH/);
    const staged = await cas.stage(bytes, expected, metadata()); await cas.finalize(staged); assert.deepEqual([...await cas.read(expected, tenantId("tenant-a"))], [...bytes]);
    await assert.rejects(cas.read(expected, tenantId("tenant-b")), /NOT_FOUND/);
    const duplicate = await cas.stage(bytes, expected, metadata()); await cas.finalize(duplicate); assert.deepEqual([...await cas.read(expected, tenantId("tenant-a"))], [...bytes]);
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
