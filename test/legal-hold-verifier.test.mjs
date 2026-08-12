import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { Ed25519LegalHoldAuthorizationVerifier } from "../dist/infrastructure/artifact-lineage/ed25519-hold-verifier.js";
import { canonicalJson } from "../dist/index.js";

test("legal hold authority is an opaque signed scoped receipt", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = { tenantId: "tenant-a", manifestDigest: "ab".repeat(32), action: "PLACE", actor: "governance", expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: "nonce-1" };
  const receipt = { payload, algorithm: "ed25519", keyId: "governance/1", signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") };
  const verifier = new Ed25519LegalHoldAuthorizationVerifier({ "governance/1": publicKey.export({ type: "spki", format: "pem" }) });
  assert.deepEqual(await verifier.verify({ receipt: Buffer.from(JSON.stringify(receipt)).toString("base64url") }), payload);
  const tampered = { ...receipt, payload: { ...payload, action: "RELEASE" } };
  await assert.rejects(verifier.verify({ receipt: Buffer.from(JSON.stringify(tampered)).toString("base64url") }), /SIGNATURE/);
});
