import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { LocalContentAddressedStorage } from "../dist/contexts/artifact-lineage/infrastructure/local-cas.js";
import { digestBytes, digestReference } from "../dist/shared-kernel/digest.js";
import { tenantId, repositoryId } from "../dist/shared-kernel/identity.js";
import { artifactReadGrant } from "../dist/contexts/artifact-lineage/application/cas-port.js";

await mkdir("reports", { recursive: true }); const root = await mkdtemp(join(tmpdir(), "agentics-p04-bench-"));
try {
  const cas = new LocalContentAddressedStorage(root); const tenant = tenantId("bench-tenant"); const repository = repositoryId("bench-repo");
  const samples = []; const count = 250; const bytes = Buffer.alloc(1024 * 1024, 7); const digest = digestBytes(bytes);
  const reference = digestReference({ uri: `cas://sha256/${digest}`, sha256: digest });
  const grant = artifactReadGrant(tenant, repository);
  for (let index = 0; index < count; index++) { const started = performance.now(); const staged = await cas.stage(bytes, reference, { tenantId: tenant, repositoryId: repository, mediaType: "application/octet-stream", classification: "INTERNAL", retention: "OPERATIONAL_SCRATCH", legalHold: false }); await cas.finalize(staged); await cas.read(reference, grant); samples.push(performance.now() - started); }
  samples.sort((a, b) => a - b); const percentile = p => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
  const report = { schema: "agentics.prompt-04-benchmark/v1", fixture: { operations: count, bytesPerOperation: bytes.length }, localCas: { p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: samples.at(-1), throughputMiBPerSecond: count / (samples.reduce((a,b)=>a+b,0)/1000) }, limits: { p99Ms: 250, minimumThroughputMiBPerSecond: 5 }, environment: { node: process.version, platform: process.platform, arch: process.arch, rssBytes: process.memoryUsage().rss } };
  if (report.localCas.p99Ms > report.limits.p99Ms || report.localCas.throughputMiBPerSecond < report.limits.minimumThroughputMiBPerSecond) throw new Error("PROMPT_04_BENCHMARK_REGRESSION");
  await writeFile("reports/prompt-04-benchmark.json", `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report));
} finally { await rm(root, { recursive: true, force: true }); }
