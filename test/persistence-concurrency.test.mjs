import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PubSub } from "@google-cloud/pubsub";
import {
  actorId, aggregateId, correlationId, causationId, createEnvelope, cycleId, digestBytes, digestReference, eventId,
  idempotencyKey, PostgresPersistence, PostgresLocalTransport, CriticalResourceStore, repositoryId, sourceSnapshot, tenantId, utcInstant,
  withSerializableRetry, GooglePubSubTransport, GooglePubSubConsumer
} from "../dist/index.js";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;
const configuration = { connectionString: url, maxConnections: 64, statementTimeoutMs: 10_000, lockTimeoutMs: 2_000 };

function messageEnvelope(seed, tenant = "tenant-a", aggregate = "transport-a", keySeed = 3) {
  const bytes = new TextEncoder().encode(`evidence-${seed}`); const digest = digestBytes(bytes);
  return createEnvelope({ envelopeSchema: "agentics.evolution-envelope/v1", schemaVersion: 1,
    id: eventId(`0198a41d-2c00-7000-8000-${seed.toString().padStart(12, "0")}`), type: "TransportTested", tenantId: tenantId(tenant),
    repositoryId: repositoryId("repo-a"), aggregateId: aggregateId(aggregate), cycleId: cycleId("cycle-a"), actorId: actorId("actor-a"),
    occurredAt: utcInstant("2026-08-12T00:00:00.000Z"), causationId: causationId("0198a41d-2c00-7000-8000-100000000001"),
    correlationId: correlationId("0198a41d-2c00-7000-8000-100000000002"), idempotencyKey: idempotencyKey(`0198a41d-2c00-7000-8000-${keySeed.toString().padStart(12, "0")}`),
    policyEpoch: 1, sourceRef: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }),
    evidence: [digestReference({ uri: `cas://sha256/${digest}`, sha256: digest })], payload: { tenantId: tenant, repositoryId: "repo-a" } });
}

test("command idempotency returns the original outcome and rejects digest conflicts", { skip: !url }, async () => {
  const suffix = `${process.pid}${Date.now()}`.slice(-10); const tenant = `idempotency-${suffix}`;
  const envelope = messageEnvelope(31, tenant, `aggregate-${suffix}`, 31);
  const database = new PostgresPersistence(configuration);
  try {
    const write = { aggregateType: "idempotency-test", expectedVersion: 0, state: { value: 1 }, event: envelope, topic: "evolution.events.v1" };
    const first = await database.executeCommand(write); const duplicate = await database.executeCommand(write);
    assert.equal(first.duplicate, false); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.eventId, first.eventId);
    await assert.rejects(database.executeCommand({ ...write, state: { value: 2 } }), /IDEMPOTENCY_CONFLICT/);
    const counts = await database.pool.query(`SELECT
      (SELECT count(*)::int FROM domain_events WHERE tenant_id=$1) events,
      (SELECT count(*)::int FROM outbox WHERE tenant_id=$1) outbox,
      (SELECT count(*)::int FROM command_idempotency WHERE tenant_id=$1) commands`, [tenant]);
    assert.deepEqual(counts.rows[0], { events: 1, outbox: 1, commands: 1 });
  } finally { await database.close(); }
});

test("100 serializable contenders cannot overspend alpha or budget", { skip: !url }, async () => {
  const admin = new Client({ connectionString: url }); await admin.connect(); await admin.query("DELETE FROM critical_resources WHERE tenant_id='tenant-a' AND resource_id IN ('alpha-c','budget-c')"); await admin.end();
  const database = new PostgresPersistence(configuration); const store = new CriticalResourceStore(database);
  try {
    for (const resourceType of ["alpha", "budget"]) {
      const resourceId = `${resourceType}-c`; await store.initialize({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType, resourceId }, 1n);
      const outcomes = await Promise.allSettled(Array.from({ length: 100 }, () => store.spend({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType, resourceId, expectedVersion: 0 }, 1n)));
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(outcomes.find((item) => item.status === "fulfilled").value.remaining, 0n);
    }
  } finally { await database.close(); }
});

test("serializable retry is bounded, jittered and never retries permanent errors", async () => {
  let attempts = 0; const delays = [];
  const result = await withSerializableRetry(async () => {
    attempts++; if (attempts < 3) throw Object.assign(new Error("serialization"), { code: "40001" }); return "committed";
  }, { maxAttempts: 5, baseDelayMs: 10, deadlineMs: Date.now() + 1_000, random: () => 0.5, sleep: async (delay) => { delays.push(delay); } });
  assert.equal(result, "committed"); assert.equal(attempts, 3); assert.deepEqual(delays, [5, 10]);
  attempts = 0;
  await assert.rejects(withSerializableRetry(async () => { attempts++; throw Object.assign(new Error("constraint"), { code: "23505" }); },
    { maxAttempts: 5, baseDelayMs: 10, deadlineMs: Date.now() + 1_000, sleep: async () => undefined }), /constraint/);
  assert.equal(attempts, 1);
});

test("authorization consumption and champion CAS have one winner", { skip: !url }, async () => {
  const admin = new Client({ connectionString: url }); await admin.connect(); await admin.query("DELETE FROM critical_resources WHERE tenant_id='tenant-a' AND resource_id IN ('auth-c','champ-c')"); await admin.end();
  const database = new PostgresPersistence(configuration); const store = new CriticalResourceStore(database);
  try {
    await store.initialize({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "authorization", resourceId: "auth-c" }, null);
    const auth = await Promise.allSettled(Array.from({ length: 100 }, () => store.consumeAuthorization({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "authorization", resourceId: "auth-c", expectedVersion: 0 })));
    assert.equal(auth.filter((item) => item.status === "fulfilled").length, 1);
    await store.initialize({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "champion", resourceId: "champ-c" }, null);
    const champion = await Promise.allSettled(Array.from({ length: 100 }, (_, candidate) => store.changeChampion({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "champion", resourceId: "champ-c", expectedVersion: 0 }, { candidate })));
    assert.equal(champion.filter((item) => item.status === "fulfilled").length, 1);
  } finally { await database.close(); }
});

test("durable local transport supports at-least-once nack/redelivery and fenced ack", { skip: !url }, async () => {
  const database = new PostgresPersistence(configuration); const transport = new PostgresLocalTransport(database); const envelope = messageEnvelope(10);
  try {
    await database.tenantTransaction("tenant-a", "READ COMMITTED", (client) => client.query("DELETE FROM local_transport_messages WHERE tenant_id='tenant-a' AND event_id=$1", [envelope.id]).then(() => undefined));
    const message = { envelope, orderingKey: "tenant-a/repo-a/transport-a", attributes: { correlationId: envelope.correlationId, causationId: envelope.causationId } };
    await transport.publish("evolution.events.v1", message); await transport.publish("evolution.events.v1", message);
    const first = await transport.pull("tenant-a", "evolution.events.v1"); assert.equal(first.length, 1);
    await transport.nack("tenant-a", first[0].messageId, first[0].leaseToken);
    const second = await transport.pull("tenant-a", "evolution.events.v1"); assert.equal(second.length, 1);
    await assert.rejects(transport.ack("tenant-a", second[0].messageId, first[0].leaseToken), /STALE/);
    await transport.ack("tenant-a", second[0].messageId, second[0].leaseToken);
    assert.equal((await transport.pull("tenant-a", "evolution.events.v1")).length, 0);
  } finally { await database.close(); }
});

test("Pub/Sub emulator uses the same validated message contract and redelivers nack", { skip: !process.env.PUBSUB_EMULATOR_HOST }, async () => {
  const projectId = "agentics-test"; const client = new PubSub({ projectId });
  const suffix = `${process.pid}-${Date.now()}`; const topicName = "evolution.events.v1"; const subscriptionName = `agentics-events-${suffix}`;
  const [topic] = await client.createTopic(topicName); await topic.createSubscription(subscriptionName, { ackDeadlineSeconds: 10 });
  const envelope = messageEnvelope(41); const message = { envelope, orderingKey: "tenant-a/repo-a/transport-a",
    attributes: { correlationId: envelope.correlationId, causationId: envelope.causationId } };
  const publisher = new GooglePubSubTransport(client);
  const consumer = new GooglePubSubConsumer(client, (bytes, attributes, orderingKey) => ({
    envelope: JSON.parse(new TextDecoder().decode(bytes)), orderingKey, attributes
  }));
  try {
    const receipt = await publisher.publish(topicName, message); assert.ok(receipt.messageId);
    const first = await consumer.receiveOne(subscriptionName); assert.equal(first.message.envelope.id, envelope.id); assert.equal(first.message.orderingKey, message.orderingKey); first.nack();
    const second = await consumer.receiveOne(subscriptionName); assert.equal(second.messageId, first.messageId); second.ack();
  } finally { await client.subscription(subscriptionName).delete().catch(() => undefined); await topic.delete().catch(() => undefined); await client.close(); }
});
