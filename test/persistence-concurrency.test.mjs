import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PubSub } from "@google-cloud/pubsub";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  actorId, aggregateId, correlationId, causationId, createEnvelope, cycleId, digestBytes, digestReference, eventId,
  idempotencyKey, PostgresPersistence, PostgresLocalTransport, CriticalResourceStore, repositoryId, sourceSnapshot, tenantId, utcInstant,
  withSerializableRetry, GooglePubSubTransport, GooglePubSubConsumer, GooglePubSubPoisonSink, validateTransportMessage, MAX_ENVELOPE_BYTES,
  ReplayCapabilityVerifier, replayEffectPolicy, canonicalJson
} from "../dist/index.js";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;
const configuration = { connectionString: url, maxConnections: 64, statementTimeoutMs: 10_000, lockTimeoutMs: 2_000, enforceRuntimeRole: false };

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
const criticalAudit = (seed, resourceId) => ({ event: messageEnvelope(seed, "tenant-a", resourceId, 1_000 + seed), topic: "evolution.events.v1" });

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
  const database = new PostgresPersistence(configuration); const store = new CriticalResourceStore(database);
  try {
    for (const resourceType of ["alpha", "budget"]) {
      const resourceId = `${resourceType}-${process.pid}-${Date.now()}`; await store.initialize({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType, resourceId }, 1n);
      const offset = resourceType === "alpha" ? 100 : 200;
      const outcomes = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => store.spend(
        { tenantId: "tenant-a", repositoryId: "repo-a", resourceType, resourceId, expectedVersion: 0 }, 1n, criticalAudit(offset + index, resourceId))));
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(outcomes.find((item) => item.status === "fulfilled").value.remaining, 0n);
      const persisted = await database.pool.query("SELECT (SELECT count(*)::int FROM domain_events WHERE tenant_id='tenant-a' AND aggregate_id=$1) events,(SELECT count(*)::int FROM outbox WHERE tenant_id='tenant-a' AND aggregate_id=$1) outbox", [resourceId]);
      assert.deepEqual(persisted.rows[0], { events: 1, outbox: 1 });
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

test("transport enforces exact 256 KiB UTF-8 boundary and trace binding", () => {
  const envelope = messageEnvelope(35); const attributes = { correlationId: envelope.correlationId, causationId: envelope.causationId,
    traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01" };
  const baseMessage = { envelope: { ...envelope, payload: { data: "" } }, orderingKey: "tenant-a/repo-a/transport-a", attributes };
  const baseBytes = validateTransportMessage(baseMessage).byteLength;
  const exact = { ...baseMessage, envelope: { ...baseMessage.envelope, payload: { data: "x".repeat(MAX_ENVELOPE_BYTES - baseBytes) } } };
  assert.equal(validateTransportMessage(exact).byteLength, MAX_ENVELOPE_BYTES);
  const oversized = { ...exact, envelope: { ...exact.envelope, payload: { data: `${exact.envelope.payload.data}x` } } };
  assert.throws(() => validateTransportMessage(oversized), /PAYLOAD_TOO_LARGE/);
  assert.throws(() => validateTransportMessage({ ...baseMessage, attributes: { ...attributes, traceparent: "attacker" } }), /INVALID_TRACEPARENT/);
  assert.throws(() => validateTransportMessage({ ...baseMessage, orderingKey: "tenant-a/repo-b/transport-a" }), /INVALID_ORDERING_KEY/);
});

test("replay is dry-run by default and live effects require signed scoped capability", () => {
  const envelope = messageEnvelope(36); const dryRun = replayEffectPolicy("DRY_RUN", envelope);
  assert.equal(dryRun.allowExternalEffects, false); assert.equal(dryRun.allowNormalTopicPublish, false);
  assert.throws(() => replayEffectPolicy("LIVE", envelope, { statement: {} }), /VERIFIED_REPLAY_CAPABILITY_REQUIRED/);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const verifier = new ReplayCapabilityVerifier({ governance: publicKey.export({ type: "spki", format: "pem" }) });
  const statement = { schema: "agentics.replay-capability/v1", replayId: "replay-1", issuer: "governance", tenantId: envelope.tenantId,
    repositoryId: envelope.repositoryId, eventTypes: [envelope.type], expiresAt: "2026-08-13T00:00:00.000Z" };
  const bytes = new TextEncoder().encode(canonicalJson(statement)); const capability = verifier.verify(bytes, sign(null, bytes, privateKey));
  const live = replayEffectPolicy("LIVE", envelope, capability, Date.parse("2026-08-12T00:00:00.000Z"));
  assert.equal(live.allowExternalEffects, true); assert.equal(live.allowNormalTopicPublish, false); assert.equal(live.replayId, "replay-1");
  assert.throws(() => replayEffectPolicy("LIVE", { ...envelope, tenantId: "tenant-b" }, capability, Date.parse("2026-08-12T00:00:00.000Z")), /REPLAY_SCOPE_MISMATCH/);
  assert.throws(() => replayEffectPolicy("LIVE", envelope, capability, Date.parse("2026-08-14T00:00:00.000Z")), /REPLAY_CAPABILITY_EXPIRED/);
  const altered = new TextEncoder().encode(canonicalJson({ ...statement, tenantId: "tenant-b" }));
  assert.throws(() => verifier.verify(altered, sign(null, bytes, privateKey)), /UNTRUSTED_REPLAY_CAPABILITY/);
});

test("authorization consumption and champion CAS have one winner", { skip: !url }, async () => {
  const database = new PostgresPersistence(configuration); const store = new CriticalResourceStore(database);
  try {
    const suffix = `${process.pid}-${Date.now()}`; const authId = `auth-${suffix}`; const championId = `champ-${suffix}`;
    await store.initialize({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "authorization", resourceId: authId }, null);
    const auth = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => store.consumeAuthorization(
      { tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "authorization", resourceId: authId, expectedVersion: 0 }, criticalAudit(300 + index, authId))));
    assert.equal(auth.filter((item) => item.status === "fulfilled").length, 1);
    await store.initialize({ tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "champion", resourceId: championId }, null);
    const champion = await Promise.allSettled(Array.from({ length: 100 }, (_, candidate) => store.changeChampion(
      { tenantId: "tenant-a", repositoryId: "repo-a", resourceType: "champion", resourceId: championId, expectedVersion: 0 }, { candidate }, criticalAudit(400 + candidate, championId))));
    assert.equal(champion.filter((item) => item.status === "fulfilled").length, 1);
    for (const resourceId of [authId, championId]) {
      const persisted = await database.pool.query("SELECT (SELECT count(*)::int FROM domain_events WHERE tenant_id='tenant-a' AND aggregate_id=$1) events,(SELECT count(*)::int FROM outbox WHERE tenant_id='tenant-a' AND aggregate_id=$1) outbox", [resourceId]);
      assert.deepEqual(persisted.rows[0], { events: 1, outbox: 1 });
    }
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
  const suffix = `${process.pid}-${Date.now()}`; const topicName = "evolution.events.v1"; const deadLetterTopicName = "evolution.deadletter.v1";
  const subscriptionName = `agentics-events-${suffix}`; const poisonSubscription = `agentics-poison-${suffix}`; const deadLetterSubscription = `agentics-dead-${suffix}`;
  const [topic] = await client.createTopic(topicName); const [deadLetterTopic] = await client.createTopic(deadLetterTopicName);
  await topic.createSubscription(subscriptionName, { ackDeadlineSeconds: 10 }); await deadLetterTopic.createSubscription(deadLetterSubscription, { ackDeadlineSeconds: 10 });
  const envelope = messageEnvelope(41); const message = { envelope, orderingKey: "tenant-a/repo-a/transport-a",
    attributes: { correlationId: envelope.correlationId, causationId: envelope.causationId } };
  const publisher = new GooglePubSubTransport(client);
  const consumer = new GooglePubSubConsumer(client, (bytes, attributes, orderingKey) => ({
    envelope: JSON.parse(new TextDecoder().decode(bytes)), orderingKey, attributes
  }), new GooglePubSubPoisonSink(client));
  try {
    const receipt = await publisher.publish(topicName, message); assert.ok(receipt.messageId);
    const first = await consumer.receiveOne(subscriptionName); assert.equal(first.message.envelope.id, envelope.id); assert.equal(first.message.orderingKey, message.orderingKey); first.nack();
    const second = await consumer.receiveOne(subscriptionName); assert.equal(second.messageId, first.messageId); await second.ack();
    await topic.createSubscription(poisonSubscription, { ackDeadlineSeconds: 10 });
    await topic.publishMessage({ data: Buffer.from("{malformed"), orderingKey: message.orderingKey,
      attributes: { correlationId: envelope.correlationId, causationId: envelope.causationId, traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01", secret: "must-not-propagate" } });
    let poisonRejected = false;
    for (let attempt = 0; attempt < 4 && !poisonRejected; attempt++) {
      try { await (await consumer.receiveOne(poisonSubscription)).ack(); }
      catch (error) { assert.match(String(error), /PUBSUB_POISON_DEAD_LETTERED/); poisonRejected = true; }
    }
    assert.equal(poisonRejected, true);
    const poison = await new Promise((resolve, reject) => {
      const subscription = client.subscription(deadLetterSubscription); const timer = setTimeout(() => reject(new Error("dead-letter timeout")), 5_000);
      subscription.once("message", (raw) => { clearTimeout(timer); raw.ack(); resolve(JSON.parse(raw.data.toString("utf8"))); }); subscription.once("error", reject);
    });
    assert.equal(poison.reason, "MALFORMED_ENVELOPE"); assert.equal(poison.attributes.correlationId, envelope.correlationId);
    assert.equal(poison.attributes.traceparent, "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"); assert.equal("secret" in poison.attributes, false);
  } finally {
    await client.subscription(subscriptionName).delete().catch(() => undefined); await client.subscription(poisonSubscription).delete().catch(() => undefined);
    await client.subscription(deadLetterSubscription).delete().catch(() => undefined);
    await topic.delete().catch(() => undefined); await deadLetterTopic.delete().catch(() => undefined); await client.close();
  }
});
