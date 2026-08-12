import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import pg from "pg";
import { canonicalJson, consumeOnce, OutboxRelay, PostgresPersistence, ReplayCapabilityVerifier } from "../dist/index.js";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;
const worker = new URL("fixtures/postgres-crash-worker.mjs", import.meta.url).pathname;
const databaseConfig = { connectionString: url, maxConnections: 4, statementTimeoutMs: 5_000, lockTimeoutMs: 1_000, enforceRuntimeRole: false };

async function killAt(stage, marker, tenant, eventId) {
  const child = spawn(process.execPath, [worker, stage, tenant, eventId], { env: { ...process.env, TEST_DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    let output = ""; let errors = ""; child.stdout.on("data", (data) => { output += data; if (output.includes(marker)) resolve(); });
    child.stderr.on("data", (data) => { errors += data; }); child.on("error", reject);
    child.on("exit", (code) => { if (!output.includes(marker)) reject(new Error(`worker exited ${code}: ${errors}`)); });
    setTimeout(() => reject(new Error(`worker missed ${marker}: ${output} ${errors}`)), 5_000).unref();
  });
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
}
const runId = `${process.pid}-${Date.now()}`;

test("SIGKILL after writes before commit exposes no aggregate, event, or outbox", { skip: !url }, async () => {
  const tenant = `crash-before-${runId}`; const eventId = "0198a41d-2c00-7000-8000-000000000021";
  await killAt("before-commit", "BARRIER", tenant, eventId);
  const client = new Client({ connectionString: url }); await client.connect();
  try { for (const table of ["aggregates", "domain_events", "outbox"]) assert.equal((await client.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1`, [tenant])).rowCount, 0); }
  finally { await client.end(); }
});

test("SIGKILL after commit leaves one logical outbox event that restart publishes", { skip: !url }, async () => {
  const tenant = `crash-after-${runId}`; const eventId = "0198a41d-2c00-7000-8000-000000000022";
  await killAt("after-commit", "COMMITTED", tenant, eventId);
  const published = []; const transport = { publish: async (_topic, message) => { published.push(message.envelope.id); return { messageId: "broker-1" }; } };
  const database = new PostgresPersistence(databaseConfig);
  try {
    const relay = new OutboxRelay(database, transport); assert.equal(await relay.drain(tenant), 1); assert.deepEqual(published, [eventId]);
    assert.equal(await relay.drain(tenant), 0);
    const rows = await database.pool.query("SELECT published_at,broker_message_id FROM outbox WHERE tenant_id=$1 AND event_id=$2", [tenant, eventId]);
    assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].broker_message_id, "broker-1");
  } finally { await database.close(); }
});

test("broker acceptance before delivery mark may republish but inbox applies one effect", { skip: !url }, async () => {
  const tenant = `crash-after-ack-${runId}`; const eventId = "0198a41d-2c00-7000-8000-000000000023";
  await killAt("after-commit", "COMMITTED", tenant, eventId);
  const physical = [];
  let loseAcknowledgement = true;
  const transport = { publish: async (_topic, message) => {
    physical.push(message);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("BROKER_ACCEPTED_ACK_LOST"); }
    return { messageId: "broker-retry" };
  } };
  const database = new PostgresPersistence(databaseConfig);
  try {
    const relay = new OutboxRelay(database, transport);
    await assert.rejects(relay.drain(tenant), /BROKER_ACCEPTED_ACK_LOST/);
    await database.pool.query("UPDATE outbox SET lease_expires_at=transaction_timestamp()-interval '1 second',next_attempt_at=transaction_timestamp() WHERE tenant_id=$1 AND event_id=$2", [tenant, eventId]);
    assert.equal(await relay.drain(tenant), 1);
    assert.equal(physical.length, 2, "physical duplicate is expected at the acknowledgement boundary");
    let effects = 0;
    const first = await consumeOnce(database, tenant, "crash-consumer", physical[0].envelope, async () => ++effects);
    const duplicate = await consumeOnce(database, tenant, "crash-consumer", physical[1].envelope, async () => ++effects);
    assert.equal(first.duplicate, false); assert.equal(duplicate.duplicate, true); assert.equal(effects, 1);
    const altered = { ...physical[1].envelope, payload: { altered: true } };
    await assert.rejects(consumeOnce(database, tenant, "crash-consumer", altered, async () => ++effects), /INBOX_EVENT_DIGEST_CONFLICT/);
    await assert.rejects(consumeOnce(database, "foreign-tenant", "crash-consumer", physical[1].envelope, async () => ++effects), /EVENT_TENANT_MISMATCH/);
    assert.equal(effects, 1);
  } finally { await database.close(); }
});

test("terminal publish failure is attributable and requires authorization to redrive", { skip: !url }, async () => {
  const tenant = `dead-letter-${runId}`; const eventId = "0198a41d-2c00-7000-8000-000000000024";
  await killAt("after-commit", "COMMITTED", tenant, eventId);
  const database = new PostgresPersistence(databaseConfig);
  try {
    const failing = new OutboxRelay(database, { publish: async () => { throw new Error("BROKER_UNAVAILABLE"); } }, 1);
    await assert.rejects(failing.drain(tenant), /BROKER_UNAVAILABLE/);
    const dead = await database.pool.query("SELECT reason_code,source_topic,repository_id,aggregate_id,attempts,redrive_count FROM dead_letters WHERE tenant_id=$1 AND event_id=$2", [tenant, eventId]);
    assert.equal(dead.rowCount, 1); assert.deepEqual(dead.rows[0], { reason_code: "PUBLISH_EXHAUSTED", source_topic: "evolution.events.v1",
      repository_id: "repo-crash", aggregate_id: "aggregate-crash", attempts: 1, redrive_count: 0 });
    await assert.rejects(failing.redrive(tenant, eventId, {}), /VERIFIED_REPLAY_CAPABILITY_REQUIRED/);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const verifier = new ReplayCapabilityVerifier({ governance: publicKey.export({ type: "spki", format: "pem" }) });
    const statement = { schema: "agentics.replay-capability/v1", replayId: `redrive-${eventId}`, issuer: "governance", tenantId: tenant,
      repositoryId: "repo-crash", eventTypes: ["CrashTested"], expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const bytes = new TextEncoder().encode(canonicalJson(statement)); const capability = verifier.verify(bytes, sign(null, bytes, privateKey));
    await failing.redrive(tenant, eventId, capability);
    const successful = new OutboxRelay(database, { publish: async () => ({ messageId: "broker-redrive" }) });
    assert.equal(await successful.drain(tenant), 1);
    const audited = await database.pool.query("SELECT redrive_count,redriven_at FROM dead_letters WHERE tenant_id=$1 AND event_id=$2", [tenant, eventId]);
    assert.equal(audited.rows[0].redrive_count, 1); assert.ok(audited.rows[0].redriven_at);
  } finally { await database.close(); }
});
