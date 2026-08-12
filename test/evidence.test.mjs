import test from "node:test";
import assert from "node:assert/strict";
import { createSigner, requireTrustedPublicKey, signEnvelope, validateSlsaV1, verifyEnvelope } from "../scripts/lib/evidence.mjs";

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

test("production verification fails closed without a separately trusted key", () => {
  assert.throws(() => requireTrustedPublicKey(undefined, "production", "embedded"), /separately trusted/);
  assert.equal(requireTrustedPublicKey("configured", "production", "embedded"), "configured");
  assert.equal(requireTrustedPublicKey(undefined, "test", "embedded"), "embedded");
});

test("mislabeled provenance without SLSA v1 fields is rejected", () => {
  assert.throws(() => validateSlsaV1({ predicateType: "https://slsa.dev/provenance/v1" }), /in-toto/);
  assert.throws(() => validateSlsaV1({ _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1", subject: [] }), /subjects/);
});

test("Prompt05 signed provenance binds invocation metadata to its build type",()=>{const statement={_type:"https://in-toto.io/Statement/v1",subject:[{name:"artifact",digest:{sha256:"a".repeat(64)}}],predicateType:"https://slsa.dev/provenance/v1",predicate:{buildDefinition:{buildType:"https://agentics.dev/build-types/prompt-05-evidence/v1",externalParameters:{},internalParameters:{},resolvedDependencies:[]},runDetails:{builder:{id:"fixture"},metadata:{invocationId:"abc:prompt-05",startedOn:new Date().toISOString(),finishedOn:new Date().toISOString()}}}};const verified=validateSlsaV1(verifyEnvelope(signEnvelope(statement,createSigner())));assert.match(verified.predicate.runDetails.metadata.invocationId,/:prompt-05$/);});
