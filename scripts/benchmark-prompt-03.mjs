import pg from "pg";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
const samples = [];
try {
  for (let round = 0; round < 100; round++) {
    const started = performance.now();
    await client.query("SELECT version,state FROM aggregates WHERE tenant_id=$1 AND repository_id=$2 AND aggregate_id=$3", ["benchmark", "repo", `aggregate-${round}`]);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const plans = {};
  for (const [name, query, parameters] of [
    ["aggregate-load", "SELECT version,state FROM aggregates WHERE tenant_id=$1 AND repository_id=$2 AND aggregate_id=$3", ["benchmark","repo","aggregate-1"]],
    ["outbox-claim", "SELECT event_id FROM outbox WHERE tenant_id=$1 AND published_at IS NULL AND next_attempt_at<=transaction_timestamp() ORDER BY created_at LIMIT 50", ["benchmark"]],
    ["inbox-dedupe", "SELECT event_id FROM inbox WHERE tenant_id=$1 AND consumer=$2 AND event_id=$3", ["benchmark","consumer","0198a41d-2c00-7000-8000-000000000001"]]
  ]) plans[name] = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`, parameters)).rows[0]["QUERY PLAN"];
  const report = { schemaVersion: "agentics.prompt-03-benchmark/v1", fixture: { aggregateLookups: 100 },
    latencyMs: { p50: samples[50], p95: samples[95], p99: samples[99], max: samples[99] }, plans,
    connections: 1, passed: samples[99] < 250 };
  if (!report.passed) throw new Error(`aggregate lookup max ${samples[99]}ms exceeds 250ms`);
  await writeFile("reports/prompt-03-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PostgreSQL aggregate lookup p95=${samples[95].toFixed(3)}ms p99=${samples[99].toFixed(3)}ms`);
} finally { await client.end(); }
