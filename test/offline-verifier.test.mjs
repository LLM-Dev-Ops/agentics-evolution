import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canon, makeSigner } from "@metaharness/flywheel";
import { verifyBundle } from "../packages/offline-verifier/index.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentics-offline-")); await mkdir(join(root, "objects"));
  const object = Buffer.from("immutable artifact\n"); const objectDigest = sha(object); await writeFile(join(root, "objects", objectDigest), object);
  const { privateKey: rootPrivate, publicKey: rootPublic } = generateKeyPairSync("ed25519");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = { schema: "agentics.artifact-manifest/v1", artifact: { uri: `cas://sha256/${objectDigest}`, sha256: objectDigest }, dependencies: [] };
  const manifestBytes = Buffer.from(canon(payload));
  const manifest = { payload, keyId: "cycle-v1", signature: sign(null, manifestBytes, privateKey).toString("base64") };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const keyPayload = { schema: "agentics.key-manifest/v1", sequence: 1, keys: [{ keyId: "cycle-v1", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }), purposes: ["CYCLE_WITNESS"], status: "ACTIVE" }] };
  const keyManifest = { payload: keyPayload, signerPublicKey: rootPublic.export({ type: "spki", format: "pem" }), signature: sign(null, Buffer.from(canon(keyPayload)), rootPrivate).toString("base64") };
  await writeFile(join(root, "keys.json"), JSON.stringify(keyManifest));
  const receipt = makeSigner().sign({ gate: "PASS", artifact: objectDigest }); await writeFile(join(root, "receipt.json"), JSON.stringify(receipt));
  const bundle = { schema: "agentics.offline-bundle/v1", manifest: { path: "manifest.json", sha256: sha(manifestBytes) }, objects: [{ path: `objects/${objectDigest}`, sha256: objectDigest, size: object.length }], receipt: { path: "receipt.json" }, keyManifest: { path: "keys.json" } };
  await writeFile(join(root, "bundle.json"), JSON.stringify(bundle));
  return { root, checkpoint: sha(Buffer.from(canon(keyPayload))), objectPath: join(root, "objects", objectDigest) };
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
