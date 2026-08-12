import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { aggregateId, eventId, newEventId, repositoryId, tenantId } from "../dist/index.js";

function measure(name, iterations, operation, ceilingMs) {
  const started = performance.now();
  for (let index = 0; index < iterations; index++) operation(index);
  const elapsedMs = performance.now() - started;
  if (elapsedMs > ceilingMs) throw new Error(`${name} ${elapsedMs.toFixed(2)}ms exceeds ${ceilingMs}ms ceiling`);
  return { name, iterations, elapsedMs, operationsPerSecond: iterations / elapsedMs * 1000, ceilingMs };
}

const generated = Array.from({ length: 100_000 }, newEventId);
const results = [
  measure("uuidv7-parse", generated.length, (index) => eventId(generated[index]), 5_000),
  measure("scoped-identity-parse", 100_000, (index) => {
    tenantId(`tenant-${index}`); repositoryId(`repo-${index}`); aggregateId(`aggregate-${index}`);
  }, 5_000)
];
await writeFile("reports/prompt-02-benchmark.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-02-benchmark/v1", node: process.version, results }, null, 2)}\n`);
console.log(results.map(({ name, operationsPerSecond }) => `${name}: ${operationsPerSecond.toFixed(0)} ops/s`).join("\n"));
