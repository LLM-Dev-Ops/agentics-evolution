import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  actorId, aggregateId, correlationId, causationId, createEnvelope, cycleId, digestBytes, digestReference, eventId,
  idempotencyKey, PostgresPersistence, PostgresLocalTransport, CriticalResourceStore, repositoryId, sourceSnapshot, tenantId, utcInstant
} from "../dist/index.js";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;
const configuration = { connectionString: url, maxConnections: 64, statementTimeoutMs: 10_000, lockTimeoutMs: 2_000 };

function messageEnvelope(seed) {
  const bytes = new TextEncoder().encode(`evidence-${seed}`); const digest = digestBytes(bytes);
  return createEnvelope({ envelopeSchema: "agentics.evolution-envelope/v1", schemaVersion: 1,
    id: eventId(`0198a41d-2c00-7000-8000-${seed.toString().padStart(12, "0")}`), type: "TransportTested", tenantId: tenantId("tenant-a"),
    repositoryId: repositoryId("repo-a"), aggregateId: aggregateId("transport-a"), cycleId: cycleId("cycle-a"), actorId: actorId("actor-a"),
    occurredAt: utcInstant("2026-08-12T00:00:00.000Z"), causationId: causationId("0198a41d-2c00-7000-8000-100000000001"),
    correlationId: correlationId("0198a41d-2c00-7000-8000-100000000002"), idempotencyKey: idempotencyKey("0198a41d-2c00-7000-8000-100000000003"),
    policyEpoch: 1, sourceRef: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }),
    evidence: [digestReference({ uri: `cas://sha256/${digest}`, sha256: digest })], payload: { tenantId: "tenant-a", repositoryId: "repo-a" } });
}

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
