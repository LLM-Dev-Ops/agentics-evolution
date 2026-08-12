import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, hasCurrentReceiptShape, mapUpstreamError, negotiateVersion, withDeadline } from "../dist/upstream/contract.js";

test("DDD-008 golden serialization is stable across insertion order", () => {
  const golden = '{"correlationId":"corr-1","payload":{"a":1,"z":2},"schemaVersion":"agentics.upstream-call/v1"}';
  assert.equal(canonicalJson({ schemaVersion: "agentics.upstream-call/v1", payload: { z: 2, a: 1 }, correlationId: "corr-1" }), golden);
});

test("DDD-008 version negotiation selects a supported schema and fails closed", () => {
  assert.equal(negotiateVersion(["v2", "v1"], ["v1"]), "v1");
  assert.throws(() => negotiateVersion(["v2"], ["v1"]), /INCOMPATIBLE/);
});

test("DDD-008 maps cancellation, timeout, outage, compatibility, and unknown errors", () => {
  assert.equal(mapUpstreamError("ruflo", { name: "AbortError", message: "cancelled" }).code, "CANCELLED");
  assert.deepEqual(mapUpstreamError("brain", { code: "ETIMEDOUT", message: "late" }), {
    code: "TIMEOUT", authority: "brain", retryable: true, message: "late"
  });
  assert.equal(mapUpstreamError("brain", { code: "ECONNREFUSED", message: "down" }).code, "UNAVAILABLE");
  assert.equal(mapUpstreamError("flywheel", new Error("unsupported version v9")).code, "INCOMPATIBLE");
  assert.equal(mapUpstreamError("darwin", new Error("bad output")).code, "FAILED");
});

test("DDD-008 deadline aborts the actual operation", async () => {
  await assert.rejects(withDeadline((signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    setTimeout(resolve, 1_000);
  }), 10), /deadline exceeded/);
});

test("Flywheel current receipts remain verifiable and altered legacy shapes fail closed", async () => {
  const { makeSigner, verifyReceipt } = await import("@metaharness/flywheel");
  const receipt = makeSigner().sign({ schemaVersion: "flywheel.receipt/v1", verdict: "PROMOTED" });
  assert.equal(verifyReceipt(receipt), true);
  assert.equal(hasCurrentReceiptShape(receipt) && verifyReceipt(receipt), true);
  assert.equal(hasCurrentReceiptShape({ ...receipt, alg: "rsa-sha256" }), false);
  assert.equal(hasCurrentReceiptShape({ payload: receipt.payload, signature: receipt.signature, publicKey: receipt.publicKey }), false);
});
