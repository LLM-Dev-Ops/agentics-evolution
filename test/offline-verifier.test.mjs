import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canon, makeSigner } from "@metaharness/flywheel";
import { verifyBundle } from "../packages/offline-verifier/index.mjs";
import { createRvfStore, rvfClose, rvfIngest } from "ruvector";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentics-offline-")); await mkdir(join(root, "objects"));
  const object = Buffer.from("immutable artifact\n"); const objectDigest = sha(object); await writeFile(join(root, "objects", objectDigest), object);
  const { privateKey: rootPrivate, publicKey: rootPublic } = generateKeyPairSync("ed25519");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rvfPath = join(root, "witness.rvf"); const store = await createRvfStore(rvfPath, { dimensions: 3, metric: "cosine" });
  await rvfIngest(store, [{ id: "candidate", vector: [1, 0, 0] }]); await rvfClose(store);
  const rvf = await readFile(rvfPath); const idmap = await readFile(`${rvfPath}.idmap.json`);
  await writeFile(join(root, "witness.idmap.json"), idmap); await rm(`${rvfPath}.idmap.json`);
  const orderedContent = [{ uri: `cas://sha256/${objectDigest}`, sha256: objectDigest }];
  const contentSetDigest = sha(Buffer.from(canon({ rvfSha256: sha(rvf), identityMapSha256: sha(idmap), orderedContent })));
  const payload = { schema: "agentics.artifact-manifest/v1", artifact: { uri: `cas://sha256/${objectDigest}`, sha256: objectDigest }, dependencies: [],
    rvfWitness: { rvfDigest: { uri: `cas://sha256/${sha(rvf)}`, sha256: sha(rvf) }, contentSetDigest: { uri: `cas://sha256/${contentSetDigest}`, sha256: contentSetDigest }, format: "ruvector-rvf", formatVersion: "ruvector@0.2.41/rvf@0.2.3" } };
  const manifestBytes = Buffer.from(canon(payload));
  const manifest = { payload, keyId: "cycle-v1", signature: sign(null, manifestBytes, privateKey).toString("base64") };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const keyPayload = { schema: "agentics.key-manifest/v1", sequence: 1, keys: [{ keyId: "cycle-v1", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }), purposes: ["CYCLE_WITNESS"], status: "ACTIVE" }] };
  const keyManifest = { payload: keyPayload, signerPublicKey: rootPublic.export({ type: "spki", format: "pem" }), signature: sign(null, Buffer.from(canon(keyPayload)), rootPrivate).toString("base64") };
  await writeFile(join(root, "keys.json"), JSON.stringify(keyManifest));
  const receipt = makeSigner().sign({ manifestDigest: sha(manifestBytes), artifactDigests: [objectDigest], gateFingerprint: `sha256:${"a".repeat(64)}` }); await writeFile(join(root, "receipt.json"), JSON.stringify(receipt));
  const bundle = { schema: "agentics.offline-bundle/v1", manifest: { path: "manifest.json", sha256: sha(manifestBytes) }, objects: [{ path: `objects/${objectDigest}`, sha256: objectDigest, size: object.length }], receipt: { path: "receipt.json" }, keyManifest: { path: "keys.json" },
    rvf: { path: "witness.rvf", identityMapPath: "witness.idmap.json", orderedContent } };
  await writeFile(join(root, "bundle.json"), JSON.stringify(bundle));
  return { root, checkpoint: sha(Buffer.from(canon(keyPayload))), objectDigest, objectPath: join(root, "objects", objectDigest), manifestPath: join(root, "manifest.json"),
    receiptPath: join(root, "receipt.json"), rvfPath: join(root, "witness.rvf"), idmapPath: join(root, "witness.idmap.json"), bundlePath: join(root, "bundle.json") };
}

test("offline verifier proves a complete bundle without database, cloud, or network", async t => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  const report = await verifyBundle(value.root, value.checkpoint); assert.equal(report.valid, true); assert.equal(report.objectCount, 1);
});

test("offline verifier rejects object tamper, untrusted checkpoint, and undeclared files", async t => {
  const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true }));
  await writeFile(value.objectPath, "tampered"); await assert.rejects(verifyBundle(value.root, value.checkpoint), /OBJECT_INTEGRITY_FAILURE/);
  const value2 = await fixture(); t.after(() => rm(value2.root, { recursive: true, force: true }));
  await assert.rejects(verifyBundle(value2.root, "0".repeat(64)), /UNTRUSTED_KEY_MANIFEST/);
  await writeFile(join(value2.root, "extra"), "x"); await assert.rejects(verifyBundle(value2.root, value2.checkpoint), /UNDECLARED_BUNDLE_FILE/);
});

test("offline verifier rejects receipt binding, manifest and RVF tampering", async t => {
  const receipt = await fixture(); t.after(() => rm(receipt.root, { recursive: true, force: true }));
  const value = JSON.parse(await readFile(receipt.receiptPath, "utf8"));
  await writeFile(receipt.receiptPath, JSON.stringify({ ...value, payload: { ...value.payload, manifestDigest: "0".repeat(64) } }));
  await assert.rejects(verifyBundle(receipt.root, receipt.checkpoint), /INVALID_FLYWHEEL_RECEIPT|INVALID_RECEIPT_BINDING/);
  const rvf = await fixture(); t.after(() => rm(rvf.root, { recursive: true, force: true }));
  await writeFile(rvf.rvfPath, "tampered-rvf"); await assert.rejects(verifyBundle(rvf.root, rvf.checkpoint), /RVF_WITNESS_MISMATCH/);
  const manifest = await fixture(); t.after(() => rm(manifest.root, { recursive: true, force: true }));
  const envelope = JSON.parse(await readFile(manifest.manifestPath, "utf8")); envelope.payload.dependencies = [{ digest: envelope.payload.artifact, role: "injected" }];
  await writeFile(manifest.manifestPath, JSON.stringify(envelope)); await assert.rejects(verifyBundle(manifest.root, manifest.checkpoint), /MANIFEST_DIGEST_MISMATCH/);
});

test("offline verifier tamper matrix fails every independent trust binding", async t => {
  const cases = [
    ["identity map", async value => writeFile(value.idmapPath, "tampered-idmap"), /RVF_WITNESS_MISMATCH/],
    ["missing RVF declaration", async value => { const bundle = JSON.parse(await readFile(value.bundlePath)); bundle.rvf = null; await writeFile(value.bundlePath, JSON.stringify(bundle)); }, /MISSING_RVF_BUNDLE/],
    ["duplicate object declaration", async value => { const bundle = JSON.parse(await readFile(value.bundlePath)); bundle.objects.push(bundle.objects[0]); await writeFile(value.bundlePath, JSON.stringify(bundle)); }, /DUPLICATE_BUNDLE_OBJECT/],
    ["manifest signature", async value => { const manifest = JSON.parse(await readFile(value.manifestPath)); manifest.signature = Buffer.alloc(64).toString("base64"); await writeFile(value.manifestPath, JSON.stringify(manifest)); }, /INVALID_MANIFEST_SIGNATURE/],
    ["receipt artifact binding", async value => { const receipt = makeSigner().sign({ manifestDigest: JSON.parse(await readFile(value.bundlePath)).manifest.sha256,
      artifactDigests: ["0".repeat(64)], gateFingerprint: `sha256:${"a".repeat(64)}` }); await writeFile(value.receiptPath, JSON.stringify(receipt)); }, /INVALID_RECEIPT_BINDING/],
    ["receipt gate fingerprint", async value => { const receipt = makeSigner().sign({ manifestDigest: JSON.parse(await readFile(value.bundlePath)).manifest.sha256,
      artifactDigests: [value.objectDigest], gateFingerprint: "unpinned" }); await writeFile(value.receiptPath, JSON.stringify(receipt)); }, /INVALID_RECEIPT_BINDING/]
  ];
  for (const [name, mutate, reason] of cases) await t.test(name, async () => {
    const value = await fixture(); t.after(() => rm(value.root, { recursive: true, force: true })); await mutate(value);
    await assert.rejects(verifyBundle(value.root, value.checkpoint), reason);
  });
});
