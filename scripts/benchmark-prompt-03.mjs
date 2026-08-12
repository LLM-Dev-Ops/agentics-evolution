import pg from "pg";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
const tenant = `benchmark-${process.pid}-${Date.now()}`; const fixtureRows = 10_000;
const percentile = (values, quantile) => values[Math.min(values.length - 1, Math.floor(values.length * quantile))];
const planUsesIndex = (value) => JSON.stringify(value).includes("Index Scan") || JSON.stringify(value).includes("Index Only Scan");
try {
  await client.query("BEGIN");
  await client.query(`INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state)
    SELECT $1,'repo','aggregate-'||number,'benchmark',1,jsonb_build_object('number',number) FROM generate_series(1,$2) number`, [tenant, fixtureRows]);
  await client.query(`INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope)
    SELECT $1,('0198a41d-2c00-7000-8000-'||lpad(number::text,12,'0'))::uuid,'repo','aggregate-'||number,'evolution.events.v1',
    $1||'/repo/aggregate-'||number,'{}'::jsonb FROM generate_series(1,$2) number`, [tenant, fixtureRows]);
  await client.query(`INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest)
    SELECT $1,'benchmark',('0198a41d-2c00-7000-8000-'||lpad(number::text,12,'0'))::uuid,repeat('a',64) FROM generate_series(1,$2) number`, [tenant, fixtureRows]);
  await client.query("COMMIT"); await client.query("ANALYZE aggregates; ANALYZE outbox; ANALYZE inbox");
  const samples = []; const inboxSamples = []; const claimSamples = []; const criticalSamples = [];
  const startedAll = performance.now();
  for (let round = 1; round <= 1_000; round++) {
    const started = performance.now(); await client.query("SELECT version,state FROM aggregates WHERE tenant_id=$1 AND repository_id='repo' AND aggregate_id=$2", [tenant, `aggregate-${(round % fixtureRows) + 1}`]);
    samples.push(performance.now() - started);
  }
  const elapsed = performance.now() - startedAll; samples.sort((a, b) => a - b);
  for (let round = 1; round <= 500; round++) {
    let started = performance.now(); await client.query("INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest) VALUES($1,'benchmark',$2,repeat('a',64)) ON CONFLICT DO NOTHING",
      [tenant, `0198a41d-2c00-7000-8000-${String((round % fixtureRows) + 1).padStart(12, "0")}`]); inboxSamples.push(performance.now() - started);
    started = performance.now(); await client.query("BEGIN"); await client.query(`SELECT event_id FROM outbox WHERE tenant_id=$1 AND published_at IS NULL AND dead_lettered_at IS NULL
      AND next_attempt_at<=transaction_timestamp() ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 50`, [tenant]); await client.query("ROLLBACK"); claimSamples.push(performance.now() - started);
  }
  await client.query("INSERT INTO critical_resources(tenant_id,repository_id,resource_type,resource_id,remaining) VALUES($1,'repo','budget','benchmark-budget',1000)", [tenant]);
  for (let round = 0; round < 100; round++) {
    const started = performance.now(); await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("UPDATE critical_resources SET remaining=remaining-1,version=version+1 WHERE tenant_id=$1 AND repository_id='repo' AND resource_type='budget' AND resource_id='benchmark-budget' AND remaining>0", [tenant]);
    await client.query("COMMIT"); criticalSamples.push(performance.now() - started);
  }
  for (const values of [inboxSamples, claimSamples, criticalSamples]) values.sort((a, b) => a - b);
  const definitions = [
    ["aggregate-load", "SELECT version,state FROM aggregates WHERE tenant_id=$1 AND repository_id=$2 AND aggregate_id=$3", [tenant,"repo","aggregate-1"]],
    ["outbox-claim", "SELECT event_id FROM outbox WHERE tenant_id=$1 AND published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at<=transaction_timestamp() ORDER BY next_attempt_at,created_at LIMIT 50", [tenant]],
    ["inbox-dedupe", "SELECT event_id FROM inbox WHERE tenant_id=$1 AND consumer=$2 AND event_id=$3", [tenant,"benchmark","0198a41d-2c00-7000-8000-000000000001"]]
  ];
  const plans = {};
  for (const [name, query, parameters] of definitions) {
    plans[name] = (await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`, parameters)).rows[0]["QUERY PLAN"];
    if (!planUsesIndex(plans[name])) throw new Error(`${name} did not use an index`);
  }
  const latencyMs = { p50: percentile(samples, .50), p95: percentile(samples, .95), p99: percentile(samples, .99), max: samples.at(-1) };
  const operationLatencyMs = { inboxDuplicateP99: percentile(inboxSamples, .99), outboxClaim50P99: percentile(claimSamples, .99), serializableBudgetP99: percentile(criticalSamples, .99) };
  const report = { schemaVersion: "agentics.prompt-03-benchmark/v3", fixture: { aggregates: fixtureRows, outbox: fixtureRows, inbox: fixtureRows, lookups: 1_000,
      duplicateInboxWrites: 500, outboxClaimBatches: 500, serializableBudgetWrites: 100 },
    latencyMs, operationLatencyMs, throughputPerSecond: 1_000 / (elapsed / 1_000), peakRssBytes: process.memoryUsage().rss, plans,
    thresholds: { lookupP99Ms: 25, inboxDuplicateP99Ms: 25, outboxClaim50P99Ms: 50, serializableBudgetP99Ms: 50, minimumThroughputPerSecond: 500, maximumRssBytes: 512 * 1024 * 1024 },
    passed: latencyMs.p99 < 25 && operationLatencyMs.inboxDuplicateP99 < 25 && operationLatencyMs.outboxClaim50P99 < 50 && operationLatencyMs.serializableBudgetP99 < 50 &&
      1_000 / (elapsed / 1_000) > 500 && process.memoryUsage().rss < 512 * 1024 * 1024 };
  if (!report.passed) throw new Error(`Prompt03 benchmark thresholds failed: ${JSON.stringify({ latencyMs, throughput: report.throughputPerSecond, rss: report.peakRssBytes })}`);
  await writeFile("reports/prompt-03-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PostgreSQL 10k fixture lookup p99=${latencyMs.p99.toFixed(3)}ms inbox=${operationLatencyMs.inboxDuplicateP99.toFixed(3)}ms claim50=${operationLatencyMs.outboxClaim50P99.toFixed(3)}ms serializable=${operationLatencyMs.serializableBudgetP99.toFixed(3)}ms`);
} finally {
  await client.query("DELETE FROM critical_resources WHERE tenant_id=$1; DELETE FROM inbox WHERE tenant_id=$1; DELETE FROM outbox WHERE tenant_id=$1; DELETE FROM aggregates WHERE tenant_id=$1", [tenant]).catch(() => undefined);
  await client.end();
}
