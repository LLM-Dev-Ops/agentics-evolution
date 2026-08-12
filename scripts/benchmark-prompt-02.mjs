import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { actorId, aggregateId, canonicalJson, createEnvelope, cycleId, digestBytes, digestReference, Ed25519AuthorityEvidenceVerifier,
  encodeEnvelope, EnvelopeSchemaRegistry, eventId, newCausationId, newCorrelationId, newEventId, newIdempotencyKey, replayTrust,
  repositoryId, sourceSnapshot, tenantId, transitionEventBinding, utcInstant } from "../dist/index.js";

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
const registry = new EnvelopeSchemaRegistry(); registry.register("HypothesisProposed", 1, { schemaId: "agentics.trust-payload/v1", allowedFields: ["tenantId", "repositoryId"], requiredFields: ["tenantId", "repositoryId"] });
for (const type of ["CandidateGenerated", "EvaluationAccepted", "PromotionAuthorized"])
  registry.register(type, 1, { schemaId: "agentics.trust-payload/v1", allowedFields: ["tenantId", "repositoryId"], requiredFields: ["tenantId", "repositoryId"] });
const keys = generateKeyPairSync("ed25519");
const authorityNames = ["Dream", "Darwin", "Flywheel", "Governance"];
const verifier = new Ed25519AuthorityEvidenceVerifier(authorityNames.map((authority) => ({ authority, keyId: `${authority.toLowerCase()}-benchmark`, publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }) })));
const evidenceStore = new Map();
const histories = Array.from({ length: 2_500 }, (_, historyIndex) => {
  const scoped = { ...identity, aggregateId: aggregateId(`benchmark-aggregate-${historyIndex}`) };
  const history = ["HypothesisProposed", "CandidateGenerated", "EvaluationAccepted", "PromotionAuthorized"].map((type, step) => {
    const base = createEnvelope({ ...envelope, ...scoped, id: newEventId(), type, evidence: [], idempotencyKey: newIdempotencyKey(), occurredAt: utcInstant(`2026-08-12T00:00:0${step}.000Z`) });
    const authority = authorityNames[step]; const statement = { schema: "agentics.authority-evidence/v1", keyId: `${authority.toLowerCase()}-benchmark`, authority,
      eventBinding: transitionEventBinding(base), verdict: ["VALIDATED", "ADMITTED", "PROVED", "AUTHORIZED"][step],
      proof: step === 0 ? { sourceValidated: true } : step === 1 ? { mutationAdmitted: true }
        : step === 2 ? { gateReceipt: `cas://sha256/${"b".repeat(64)}`, replayVerdict: "PASS", sequentialEvidence: `cas://sha256/${"c".repeat(64)}` }
        : { approvalId: "benchmark-approval", capability: "PROMOTE", constraints: {} } };
    const bytes = new TextEncoder().encode(JSON.stringify({ ...statement, signature: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64") }));
    const digest = digestBytes(bytes); const signedReference = digestReference({ uri: `cas://sha256/${digest}`, sha256: digest }); evidenceStore.set(signedReference.uri, bytes);
    return createEnvelope({ ...base, evidence: [signedReference] });
  });
  return { scoped, history };
});
const results = [
  measure("uuidv7-parse", generated.length, (index) => eventId(generated[index]), 5_000),
  measure("scoped-identity-parse", 100_000, (index) => {
    tenantId(`tenant-${index}`); repositoryId(`repo-${index}`); aggregateId(`aggregate-${index}`);
  }, 5_000),
  measure("canonical-envelope-encode", 100_000, () => encodeEnvelope(envelope), 10_000),
  measure("ten-thousand-unique-event-replay", histories.length, (index) => {
    const terminal = replayTrust(histories[index].scoped, histories[index].history, registry, (item) => evidenceStore.get(item.uri), verifier);
    if (terminal.state !== "AUTHORIZED" || terminal.version !== 4 || !terminal.historyDigest) throw new Error("replay terminal invariant failed");
  }, 10_000),
  measure("ddd-repository-scan", 1, () => execFileSync(process.execPath, ["scripts/check-ddd-boundaries.mjs"], { stdio: "ignore" }), 10_000)
];
await writeFile("reports/prompt-02-benchmark.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-02-benchmark/v1", node: process.version,
  peakRssBytes: process.memoryUsage.rss(), maximumEnvelopeBytes: 1_048_576, results }, null, 2)}\n`);
console.log(results.map(({ name, operationsPerSecond }) => `${name}: ${operationsPerSecond.toFixed(0)} ops/s`).join("\n"));
