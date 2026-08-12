import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { CloudKmsEd25519Provider } from "../dist/infrastructure/artifact-lineage/cloud-kms-ed25519.js";
import { PostgresKeyManifestStore } from "../dist/infrastructure/artifact-lineage/key-manifest-store.js";
import { TrustedManifestSealer } from "../dist/infrastructure/artifact-lineage/trusted-manifest-sealer.js";
import { activateKey, createKeyManifest } from "../dist/contexts/artifact-lineage/domain/key-manifest.js";
import { sealedManifest, stagedManifest } from "../dist/contexts/artifact-lineage/domain/artifact-manifest.js";
import { digestBytes, digestReference, repositoryId, tenantId } from "../dist/index.js";

const keyName = "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7";

test("Cloud KMS adapter pins Ed25519 key version and verifies every returned signature locally", async () => {
  const pair = generateKeyPairSync("ed25519");
  const pem = pair.publicKey.export({ type: "spki", format: "pem" });
  const client = {
    getPublicKey: async ({ name }) => [{ name, algorithm: "EC_SIGN_ED25519", pem }],
    asymmetricSign: async ({ name, data }) => [{ name, signature: sign(null, data, pair.privateKey) }]
  };
  const provider = new CloudKmsEd25519Provider(client);
  const result = await provider.signEd25519(keyName, Buffer.alloc(32, 3), new AbortController().signal);
  assert.ok(result.signature.byteLength > 0);
  await assert.rejects(provider.signEd25519("projects/p/cryptoKeys/unversioned", Buffer.alloc(32), new AbortController().signal), /KMS_KEY_VERSION_REQUIRED/);
  const downgrade = new CloudKmsEd25519Provider({ ...client, getPublicKey: async () => [{ name: keyName, algorithm: "RSA_SIGN_PSS_2048_SHA256", pem }] });
  await assert.rejects(downgrade.signEd25519(keyName, Buffer.alloc(32), new AbortController().signal), /KMS_ALGORITHM_DOWNGRADE/);
  const corrupt = new CloudKmsEd25519Provider({ ...client, asymmetricSign: async () => [{ name: keyName, signature: Buffer.alloc(64) }] });
  await assert.rejects(corrupt.signEd25519(keyName, Buffer.alloc(32), new AbortController().signal), /KMS_SIGNATURE_LOCAL_VERIFICATION_FAILED/);
});

const scope = { tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), environment: "production" };
const makeKey = (pair) => ({ keyId: "artifact/1", version: "1", purpose: "ARTIFACT_MANIFEST", algorithm: "ed25519",
  publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), validFrom: "2026-08-12T00:00:00.000Z",
  state: "PENDING", predecessor: null, revokedAt: null, revocationReason: null });

test("key-manifest rotation persists an immutable signed checkpoint, CAS head, and outbox atomically", async () => {
  const pair = generateKeyPairSync("ed25519");
  const manifest = createKeyManifest(makeKey(pair));
  const checkpoint = PostgresKeyManifestStore.checkpoint(manifest, "root/1", "signed-checkpoint");
  const calls = [];
  const database = { tenantTransaction: async (_tenant, _isolation, operation) => operation({ query: async (sql, values) => {
    calls.push([sql, values]);
    if (sql.startsWith("SELECT sequence")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  } }) };
  const verifier = { verify: async () => true };
  await new PostgresKeyManifestStore(database, verifier).rotate(scope, checkpoint, 0);
  assert.ok(calls.some(([sql]) => sql.includes("INSERT INTO key_manifest_checkpoints")));
  assert.ok(calls.some(([sql]) => sql.includes("INSERT INTO key_manifest_heads")));
  assert.ok(calls.some(([sql]) => sql.includes("INSERT INTO outbox")));
  await assert.rejects(new PostgresKeyManifestStore(database, verifier).rotate(scope, checkpoint, 1), /KEY_MANIFEST_SEQUENCE_GAP/);
  await assert.rejects(new PostgresKeyManifestStore(database, { verify: async () => false }).rotate(scope, checkpoint, 0), /KEY_MANIFEST_CHECKPOINT_SIGNATURE_INVALID/);
  const raced = { tenantTransaction: async (_tenant, _isolation, operation) => operation({ query: async (sql) =>
    sql.startsWith("SELECT sequence") ? { rows: [{ sequence: 1 }], rowCount: 1 } : { rows: [], rowCount: 1 } }) };
  await assert.rejects(new PostgresKeyManifestStore(raced, verifier).rotate(scope, checkpoint, 0), /KEY_MANIFEST_CAS_CONFLICT/);
});

test("trusted sealing rejects tampering/revoked purpose and atomically emits the seal outbox", async () => {
  const pair = generateKeyPairSync("ed25519");
  const keyManifest = activateKey(createKeyManifest(makeKey(pair)), "artifact/1");
  const artifactBytes = Buffer.from("artifact"); const sha256 = digestBytes(artifactBytes);
  const ref = digestReference({ uri: `cas://sha256/${sha256}`, sha256 });
  const staged = stagedManifest({ schema: "agentics.artifact-manifest/v1", tenantId: scope.tenantId, repositoryId: scope.repositoryId,
    artifact: ref, mediaType: "application/octet-stream", size: artifactBytes.length, producer: "test", source: { provider: "github", repository: "org/repo", revision: "a".repeat(40), clean: true },
    dependencies: [], classification: "INTERNAL", retention: "CANDIDATE_ARCHIVE", createdAt: "2026-08-12T00:00:00.000Z", rvfWitness: null });
  const signature = sign(null, Buffer.from(staged.manifestDigest.sha256, "hex"), pair.privateKey).toString("base64");
  const sealed = sealedManifest(staged, "artifact/1", signature); const calls = [];
  const database = { tenantTransaction: async (_tenant, _isolation, operation) => operation({ query: async (sql) => {
    calls.push(sql); return { rows: [], rowCount: sql.startsWith("UPDATE artifact_manifests") ? 1 : 1 };
  } }) };
  const cas = { exists: async () => true, read: async () => artifactBytes };
  await new TrustedManifestSealer(database, cas).seal(sealed, keyManifest);
  assert.ok(calls.some((sql) => sql.includes("INSERT INTO outbox")));
  await assert.rejects(new TrustedManifestSealer(database, cas).seal({ ...sealed, signature: Buffer.alloc(64).toString("base64") }, keyManifest), /MANIFEST_SIGNATURE_INVALID/);
  await assert.rejects(new TrustedManifestSealer(database, cas).seal(sealed, { ...keyManifest, active: {} }), /NO_ACTIVE_SIGNING_KEY/);
});
