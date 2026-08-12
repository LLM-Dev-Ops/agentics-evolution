import test from "node:test";
import assert from "node:assert/strict";
import { createSigner, signEnvelope, verifyEnvelope } from "../scripts/lib/evidence.mjs";

test("signed provenance envelope round trips", () => {
  const statement = { schemaVersion: "agentics.provenance/v1", source: { commit: "abc123" }, subjects: [] };
  const envelope = signEnvelope(statement, createSigner());
  assert.deepEqual(verifyEnvelope(envelope), statement);
});

test("unsigned evidence is rejected", () => {
  assert.throws(() => verifyEnvelope({ schemaVersion: "agentics.signed-evidence/v1" }), /unsigned or incomplete/);
});

test("tampered payload is rejected", () => {
  const envelope = signEnvelope({ approved: false }, createSigner());
  envelope.payload = Buffer.from('{"approved":true}').toString("base64");
  assert.throws(() => verifyEnvelope(envelope), /signature verification failed/);
});

test("untrusted signing key is rejected", () => {
  const envelope = signEnvelope({ approved: true }, createSigner());
  const otherKey = createSigner().publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => verifyEnvelope(envelope, otherKey), /not trusted/);
});
