import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import {
  activateKey, addPendingKey, createKeyManifest, revokeKey, signingKey
} from "../dist/contexts/artifact-lineage/domain/key-manifest.js";
import {
  LocalPurposeBoundSigner, RemotePurposeBoundSigner
} from "../dist/contexts/artifact-lineage/infrastructure/purpose-bound-signers.js";
import { digestReference, repositoryId, tenantId } from "../dist/index.js";

const publicKey = "MCowBQYDK2VwAyEA0123456789012345678901234567890123456789012=";
const key = (keyId, purpose = "CYCLE_WITNESS", predecessor = null) => ({ keyId, version: keyId.split("/").at(-1), purpose,
  algorithm: "ed25519", publicKey, validFrom: "2026-08-12T00:00:00.000Z", state: "PENDING", predecessor,
  revokedAt: null, revocationReason: null });

test("key rotation has one active purpose key and preserves retired verification material", () => {
  const initial = createKeyManifest(key("cycle/1"));
  const active = activateKey(initial, "cycle/1");
  const pending = addPendingKey(active, key("cycle/2", "CYCLE_WITNESS", "cycle/1"));
  const rotated = activateKey(pending, "cycle/2");
  assert.equal(signingKey(rotated, "CYCLE_WITNESS").keyId, "cycle/2");
  assert.equal(rotated.keys.find((item) => item.keyId === "cycle/1").state, "RETIRED");
  assert.equal(rotated.keys.find((item) => item.keyId === "cycle/1").publicKey, publicKey);
  assert.equal(rotated.sequence, 4);
  assert.throws(() => activateKey(rotated, "cycle/1"), /KEY_NOT_PENDING/);
});

test("revocation is append-only, disables active signing, and records historical metadata", () => {
  const active = activateKey(createKeyManifest(key("receipt/1", "EVALUATION_RECEIPT")), "receipt/1");
  const revoked = revokeKey(active, "receipt/1", "2026-08-13T00:00:00.000Z", "suspected compromise");
  const record = revoked.keys[0];
  assert.equal(record.state, "REVOKED");
  assert.equal(record.revocationReason, "suspected compromise");
  assert.equal(active.keys[0].state, "ACTIVE");
  assert.throws(() => signingKey(revoked, "EVALUATION_RECEIPT"), /NO_ACTIVE_SIGNING_KEY/);
  assert.throws(() => revokeKey(revoked, "receipt/1", "2026-08-14T00:00:00Z", "again"), /INVALID_KEY_REVOCATION/);
});

const request = (overrides = {}) => ({ tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), environment: "development",
  purpose: "CYCLE_WITNESS", payloadDigest: digestReference({ uri: `cas://sha256/${"ab".repeat(32)}`, sha256: "ab".repeat(32) }),
  keyId: "cycle/1", correlationId: "01989abc-def0-7000-8000-000000000001", deadline: new Date(Date.now() + 60_000).toISOString(), ...overrides });
const capability = { allows: (value) => value.tenantId === "tenant-a" && value.repositoryId === "repo-a" && value.purpose === "CYCLE_WITNESS" && value.keyId === "cycle/1" };

test("async local signer signs only the digest under an explicit purpose capability", async () => {
  const pair = generateKeyPairSync("ed25519");
  const signer = new LocalPurposeBoundSigner(pair.privateKey.export({ type: "pkcs8", format: "pem" }), capability, "1");
  const result = await signer.sign(request());
  assert.equal(result.keyId, "cycle/1");
  assert.equal(verify(null, Buffer.from("ab".repeat(32), "hex"), pair.publicKey, Buffer.from(result.signature, "base64")), true);
  await assert.rejects(signer.sign(request({ purpose: "RELEASE_PROVENANCE" })), /SIGNING_CAPABILITY_DENIED/);
  await assert.rejects(signer.sign(request({ deadline: "2020-01-01T00:00:00.000Z" })), /SIGNING_DEADLINE_EXPIRED/);
  assert.equal("publicKey" in signer, false, "async signing port does not expose private or synchronous Flywheel methods");
});

test("production KMS/HSM boundary fails closed when no real provider is configured", async () => {
  const signer = new RemotePurposeBoundSigner(undefined, capability, "projects/p/locations/l/keyRings/r/cryptoKeys/c/cryptoKeyVersions/1");
  await assert.rejects(signer.sign(request()), /PRODUCTION_SIGNING_PROVIDER_UNAVAILABLE/);
  await assert.rejects(signer.sign(request({ keyId: "arbitrary" })), /SIGNING_CAPABILITY_DENIED/);
});
