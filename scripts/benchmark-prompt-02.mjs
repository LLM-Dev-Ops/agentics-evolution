import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { actorId, aggregateId, createEnvelope, cycleId, digestBytes, digestReference, encodeEnvelope, EnvelopeSchemaRegistry, eventId, newCausationId,
  newCorrelationId, newEventId, newIdempotencyKey, replayTrust, repositoryId, sourceSnapshot, tenantId, utcInstant } from "../dist/index.js";

function measure(name, iterations, operation, ceilingMs) {
  const started = performance.now();
  for (let index = 0; index < iterations; index++) operation(index);
  const elapsedMs = performance.now() - started;
  if (elapsedMs > ceilingMs) throw new Error(`${name} ${elapsedMs.toFixed(2)}ms exceeds ${ceilingMs}ms ceiling`);
  const batch = Math.max(1, Math.floor(iterations / 100));
  const samples = [];
  for (let offset = 0; offset < iterations; offset += batch) {
    const sampleStarted = performance.now();
    for (let index = offset; index < Math.min(iterations, offset + batch); index++) operation(index);
    samples.push((performance.now() - sampleStarted) / batch);
  }
  samples.sort((a, b) => a - b);
  return { name, iterations, elapsedMs, operationsPerSecond: iterations / elapsedMs * 1000,
    p50Microseconds: samples[Math.floor(samples.length * .5)] * 1000, p95Microseconds: samples[Math.floor(samples.length * .95)] * 1000, ceilingMs };
}

const generated = Array.from({ length: 100_000 }, newEventId);
const identity = { tenantId: tenantId("benchmark-tenant"), repositoryId: repositoryId("benchmark-repo"), aggregateId: aggregateId("benchmark-aggregate") };
const evidenceBytes = new TextEncoder().encode("benchmark-authority-evidence");
const sha = digestBytes(evidenceBytes);
const reference = digestReference({ uri: `cas://sha256/${sha}`, sha256: sha });
const envelope = createEnvelope({ envelopeSchema: "agentics.evolution-envelope/v1", schemaVersion: 1, id: newEventId(), type: "HypothesisProposed",
  ...identity, cycleId: cycleId("benchmark-cycle"), actorId: actorId("benchmark-actor"), occurredAt: utcInstant("2026-08-12T00:00:00.000Z"),
  causationId: newCausationId(), correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey(), policyEpoch: 1,
  sourceRef: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }), evidence: [reference], payload: { tenantId: identity.tenantId, repositoryId: identity.repositoryId } });
const registry = new EnvelopeSchemaRegistry(); registry.register("HypothesisProposed", 1, () => {});
const results = [
  measure("uuidv7-parse", generated.length, (index) => eventId(generated[index]), 5_000),
  measure("scoped-identity-parse", 100_000, (index) => {
    tenantId(`tenant-${index}`); repositoryId(`repo-${index}`); aggregateId(`aggregate-${index}`);
  }, 5_000),
  measure("canonical-envelope-encode", 100_000, () => encodeEnvelope(envelope), 10_000),
  measure("ten-thousand-event-replay", 1, () => replayTrust(identity, Array(10_000).fill(envelope), registry, () => evidenceBytes, () => true), 5_000),
  measure("ddd-repository-scan", 1, () => execFileSync(process.execPath, ["scripts/check-ddd-boundaries.mjs"], { stdio: "ignore" }), 10_000)
];
await writeFile("reports/prompt-02-benchmark.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-02-benchmark/v1", node: process.version,
  peakRssBytes: process.memoryUsage.rss(), maximumEnvelopeBytes: 1_048_576, results }, null, 2)}\n`);
console.log(results.map(({ name, operationsPerSecond }) => `${name}: ${operationsPerSecond.toFixed(0)} ops/s`).join("\n"));
