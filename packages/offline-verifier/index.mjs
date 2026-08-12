import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { canon, verifyReceipt } from "@metaharness/flywheel";

const MAX_FILES = 10_000;
const MAX_JSON_BYTES = 1_048_576;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function safeFiles(root) {
  const resolved = resolve(root); const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error("UNSAFE_BUNDLE_ENTRY");
      const path = join(directory, entry.name); const rel = relative(resolved, path);
      if (!rel || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`)) throw new Error("BUNDLE_PATH_ESCAPE");
      if (entry.isDirectory()) await walk(path); else output.push(rel.split(sep).join("/"));
      if (output.length > MAX_FILES) throw new Error("BUNDLE_FILE_LIMIT");
    }
  }
  await walk(resolved); return output.sort();
}
async function json(root, name) {
  const bytes = await readFile(join(root, name)); if (bytes.length > MAX_JSON_BYTES) throw new Error("BUNDLE_JSON_LIMIT");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BUNDLE_JSON"); return value;
}
function exactKeys(value, keys, reason) {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(reason);
}

export async function verifyBundle(root, trustedCheckpoint, options = {}) {
  if (!/^[a-f0-9]{64}$/.test(trustedCheckpoint)) throw new Error("INVALID_TRUST_CHECKPOINT");
  if (!/^sha256:[a-f0-9]{64}$/.test(options.expectedGateFingerprint ?? "")) throw new Error("EXPECTED_GATE_FINGERPRINT_REQUIRED");
  if (typeof options.trustedKeyManifestSignerPem !== "string" || !options.trustedKeyManifestSignerPem.includes("PUBLIC KEY")) throw new Error("TRUSTED_KEY_MANIFEST_SIGNER_REQUIRED");
  const files = await safeFiles(root); const index = await json(root, "bundle.json");
  exactKeys(index, ["schema", "manifest", "objects", "receipt", "keyManifest", "rvf"], "INVALID_BUNDLE_INDEX");
  if (index.schema !== "agentics.offline-bundle/v1") throw new Error("UNKNOWN_BUNDLE_SCHEMA");
  const keyManifest = await json(root, index.keyManifest.path);
  if (sha256(Buffer.from(canon(keyManifest.payload))) !== trustedCheckpoint) throw new Error("UNTRUSTED_KEY_MANIFEST");
  if (keyManifest.signerPublicKey !== options.trustedKeyManifestSignerPem) throw new Error("UNTRUSTED_KEY_MANIFEST_SIGNER");
  if (!verifySignature(null, Buffer.from(canon(keyManifest.payload)), createPublicKey(keyManifest.signerPublicKey), Buffer.from(keyManifest.signature, "base64"))) throw new Error("INVALID_KEY_MANIFEST_SIGNATURE");
  const manifest = await json(root, index.manifest.path); const manifestBytes = Buffer.from(canon(manifest.payload));
  exactKeys(manifest, ["payload", "keyId", "signature"], "INVALID_MANIFEST_ENVELOPE");
  if (sha256(manifestBytes) !== index.manifest.sha256) throw new Error("MANIFEST_DIGEST_MISMATCH");
  const key = keyManifest.payload.keys.find(entry => entry.keyId === manifest.keyId);
  if (!key || key.status === "REVOKED" || !key.purposes.includes("CYCLE_WITNESS")) throw new Error("UNTRUSTED_MANIFEST_KEY");
  if (!verifySignature(null, manifestBytes, createPublicKey(key.publicKeyPem), Buffer.from(manifest.signature, "base64"))) throw new Error("INVALID_MANIFEST_SIGNATURE");
  if (!Array.isArray(index.objects) || new Set(index.objects.map(entry => entry.sha256)).size !== index.objects.length) throw new Error("DUPLICATE_BUNDLE_OBJECT");
  const objectRefs = new Map(index.objects.map(entry => [entry.sha256, entry]));
  const ordered = [manifest.payload.artifact, ...manifest.payload.dependencies.map(entry => entry.digest)];
  for (const reference of ordered) {
    const entry = objectRefs.get(reference.sha256); if (!entry) throw new Error("MISSING_BUNDLE_OBJECT");
    const bytes = await readFile(join(root, entry.path)); if (bytes.length !== entry.size || sha256(bytes) !== reference.sha256) throw new Error("OBJECT_INTEGRITY_FAILURE");
  }
  const receipt = await json(root, index.receipt.path); if (!verifyReceipt(receipt)) throw new Error("INVALID_FLYWHEEL_RECEIPT");
  const trustedReceiptKey = keyManifest.payload.keys.find(entry => entry.status === "ACTIVE" &&
    entry.purposes.includes("EVALUATION_RECEIPT") && entry.publicKey === receipt.publicKey);
  if (!trustedReceiptKey) throw new Error("UNTRUSTED_RECEIPT_SIGNER");
  exactKeys(receipt.payload, ["manifestDigest", "artifactDigests", "gateFingerprint"], "INVALID_RECEIPT_BINDING");
  if (receipt.payload.manifestDigest !== index.manifest.sha256 || !Array.isArray(receipt.payload.artifactDigests) ||
      canon(receipt.payload.artifactDigests) !== canon(ordered.map(reference => reference.sha256)) ||
      receipt.payload.gateFingerprint !== options.expectedGateFingerprint) throw new Error("INVALID_RECEIPT_BINDING");
  const rvfFiles = [];
  if (manifest.payload.rvfWitness !== null && manifest.payload.rvfWitness !== undefined) {
    if (!index.rvf) throw new Error("MISSING_RVF_BUNDLE");
    exactKeys(index.rvf, ["path", "identityMapPath", "orderedContent"], "INVALID_RVF_BUNDLE");
    const rvfBytes = await readFile(join(root, index.rvf.path)); const identityMapBytes = await readFile(join(root, index.rvf.identityMapPath));
    if (sha256(rvfBytes) !== manifest.payload.rvfWitness.rvfDigest.sha256) throw new Error("RVF_WITNESS_MISMATCH");
    const contentSet = Buffer.from(canon({ rvfSha256: sha256(rvfBytes), identityMapSha256: sha256(identityMapBytes),
      orderedContent: index.rvf.orderedContent }));
    if (sha256(contentSet) !== manifest.payload.rvfWitness.contentSetDigest.sha256 || manifest.payload.rvfWitness.format !== "ruvector-rvf")
      throw new Error("RVF_WITNESS_MISMATCH");
    const nativeVerifier = options.rvfVerifier ?? (await import("./native-rvf-plugin.mjs")).verifyNativeRvf;
    let idmap;
    try { idmap = JSON.parse(identityMapBytes); } catch { throw new Error("RVF_NATIVE_IDENTITY_MAP_INVALID"); }
    await nativeVerifier({ rvfBytes, identityMapBytes, expectedVectorCount: Object.keys(idmap.idToLabel ?? {}).length });
    rvfFiles.push(index.rvf.path, index.rvf.identityMapPath);
  } else if (index.rvf !== null) throw new Error("UNBOUND_RVF_BUNDLE");
  const declared = new Set(["bundle.json", index.manifest.path, index.receipt.path, index.keyManifest.path, ...index.objects.map(entry => entry.path), ...rvfFiles]);
  if (files.some(file => !declared.has(file)) || files.length !== declared.size) throw new Error("UNDECLARED_BUNDLE_FILE");
  return { schema: "agentics.offline-verification-report/v1", valid: true, manifestSha256: index.manifest.sha256, objectCount: ordered.length, keyManifestCheckpoint: trustedCheckpoint };
}
