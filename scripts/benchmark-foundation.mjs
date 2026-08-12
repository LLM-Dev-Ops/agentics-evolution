import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256, verifyEnvelope } from "./lib/evidence.mjs";

const envelope = JSON.parse(await readFile("reports/provenance.signed.json", "utf8"));
const rounds = 250;
const started = performance.now();
for (let index = 0; index < rounds; index += 1) {
  const statement = verifyEnvelope(envelope, envelope.publicKey);
  sha256(canonicalJson(statement));
}
const elapsedMs = performance.now() - started;
const maxMs = Number(process.env.AGENTICS_EVIDENCE_BENCHMARK_MAX_MS ?? 1500);
const result = { schemaVersion: "agentics.benchmark/v1", operation: "verify-signed-provenance", rounds, elapsedMs, maxMs, passed: elapsedMs <= maxMs };
console.log(JSON.stringify(result));
if (!result.passed) process.exit(1);
