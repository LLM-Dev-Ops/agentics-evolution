import assert from "node:assert/strict";
import { test } from "node:test";

import { NativeRvfWitnessAdapter } from "../dist/infrastructure/upstream-ruvector/rvf-witness-adapter.js";
import { digestBytes, digestReference } from "../dist/shared-kernel/digest.js";

const bytes = (text) => new TextEncoder().encode(text);
const content = (text) => {
  const sha256 = digestBytes(bytes(text));
  return digestReference({ uri: `cas://sha256/${sha256}`, sha256 });
};

const entries = Object.freeze([
  Object.freeze({ id: "candidate-alpha", vector: Object.freeze([1, 0, 0]), metadata: Object.freeze({ generation: 1 }) }),
  Object.freeze({ id: "candidate-beta", vector: Object.freeze([0, 1, 0]), metadata: Object.freeze({ generation: 1 }) })
]);

test("RVF-CREATE-INGEST-CLOSE-OPEN-QUERY-STATUS: native RVF bytes and logical identities round trip", async () => {
  const adapter = new NativeRvfWitnessAdapter();
  const orderedContent = Object.freeze([content("alpha"), content("beta")]);
  const bundle = await adapter.create(entries, orderedContent);

  assert.equal(bundle.witness.format, "ruvector-rvf");
  assert.equal(bundle.witness.rvfDigest.sha256, digestBytes(bundle.rvfBytes));
  assert.equal(bundle.vectorCount, entries.length);
  assert.equal(bundle.dimensions, 3);
  assert.deepEqual(bundle.entryIds, ["candidate-alpha", "candidate-beta"]);
  assert.ok(bundle.rvfBytes.byteLength > 0);
  assert.ok(bundle.identityMapBytes.byteLength > 0);
  await adapter.verify(bundle, orderedContent);
});

test("RVF-TAMPER-REJECTION: changed native container, identity map, or content ordering is rejected", async (t) => {
  const adapter = new NativeRvfWitnessAdapter();
  const orderedContent = Object.freeze([content("alpha"), content("beta")]);
  const bundle = await adapter.create(entries, orderedContent);

  await t.test("container bytes", async () => {
    const tampered = Uint8Array.from(bundle.rvfBytes);
    tampered[Math.floor(tampered.length / 2)] ^= 1;
    await assert.rejects(adapter.verify({ ...bundle, rvfBytes: tampered }, orderedContent), /RVF_WITNESS_MISMATCH/);
  });
  await t.test("identity map bytes", async () => {
    const tampered = Uint8Array.from(bundle.identityMapBytes);
    tampered[tampered.length - 2] ^= 1;
    await assert.rejects(adapter.verify({ ...bundle, identityMapBytes: tampered }, orderedContent), /RVF_WITNESS_MISMATCH/);
  });
  await t.test("ordered content binding", async () => {
    await assert.rejects(adapter.verify(bundle, [...orderedContent].reverse()), /RVF_WITNESS_MISMATCH/);
  });
});

test("RVF-INPUT-VALIDATION: malformed vectors and duplicate logical identities fail closed", async () => {
  const adapter = new NativeRvfWitnessAdapter();
  await assert.rejects(adapter.create([], []), /RVF_ENTRIES_REQUIRED/);
  await assert.rejects(adapter.create([
    { id: "same", vector: [1, 0] },
    { id: "same", vector: [0, 1] }
  ], []), /RVF_ENTRY_ID_DUPLICATE/);
  await assert.rejects(adapter.create([
    { id: "a", vector: [1, 0] },
    { id: "b", vector: [0] }
  ], []), /RVF_ENTRY_INVALID/);
});
