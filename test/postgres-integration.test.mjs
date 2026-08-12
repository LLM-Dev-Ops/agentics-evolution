import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgresPersistence } from "../dist/index.js";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;

test("PostgreSQL 16 migrations, FORCE RLS and append-only events execute on real database", { skip: !url }, async () => {
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    const tenant = `tenant-a-${process.pid}-${Date.now()}`;
    assert.match((await admin.query("SHOW server_version_num")).rows[0].server_version_num, /^16/);
    const flags = await admin.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)", [["aggregates","domain_events","outbox","inbox"]]);
    assert.equal(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity), true);
    await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE agentics_app"); await admin.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await admin.query("INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES($1,'repo-a','agg-a','test',1,'{}')", [tenant]);
    await admin.query("COMMIT");
    await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE agentics_app"); await admin.query("SELECT set_config('app.tenant_id','tenant-b',true)");
    assert.equal((await admin.query("SELECT * FROM aggregates WHERE tenant_id=$1", [tenant])).rowCount, 0);
    await admin.query("ROLLBACK");
    await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE agentics_app"); await admin.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    const eventId = "0198a41d-2c00-7000-8000-000000000001";
    await admin.query("INSERT INTO domain_events(tenant_id,repository_id,aggregate_id,event_id,aggregate_version,event_type,envelope,occurred_at) VALUES($1,'repo-a','agg-a',$2,1,'Tested','{}','2026-08-12T00:00:00Z')", [tenant, eventId]);
    await assert.rejects(admin.query("UPDATE domain_events SET event_type='Changed' WHERE event_id=$1", [eventId]), /append-only|permission denied/);
    await admin.query("ROLLBACK");
  } finally { await admin.end(); }
});

test("actual login role is non-bypass and pooled SET LOCAL tenant state cannot bleed", { skip: !url }, async () => {
  const unsafe = new PostgresPersistence({ connectionString: url, maxConnections: 1, statementTimeoutMs: 5_000, lockTimeoutMs: 1_000 });
  await assert.rejects(unsafe.tenantTransaction("unsafe", "READ COMMITTED", async () => undefined), /UNSAFE_POSTGRES_RUNTIME_ROLE/); await unsafe.close();
  const role = "agentics_test_runtime"; const password = "agentics-test-only";
  const admin = new Client({ connectionString: url }); await admin.connect();
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; END IF; END $$`);
  await admin.query(`ALTER ROLE ${role} PASSWORD '${password}'; GRANT agentics_app TO ${role}`); await admin.end();
  const runtimeUrl = new URL(url); runtimeUrl.username = role; runtimeUrl.password = password;
  const database = new PostgresPersistence({ connectionString: runtimeUrl.toString(), maxConnections: 1, statementTimeoutMs: 5_000, lockTimeoutMs: 1_000 });
  const tenantA = `pool-a-${process.pid}-${Date.now()}`; const tenantB = `pool-b-${process.pid}-${Date.now()}`;
  try {
    await database.verifyRuntimeSafety();
    await database.tenantTransaction(tenantA, "READ COMMITTED", (client) => client.query(
      "INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES($1,'repo-a','pool-agg','test',1,'{}')", [tenantA]).then(() => undefined));
    await database.tenantTransaction(tenantB, "READ COMMITTED", async (client) => {
      assert.equal((await client.query("SELECT * FROM aggregates WHERE tenant_id=$1", [tenantA])).rowCount, 0);
      assert.equal((await client.query("UPDATE aggregates SET state='{}' WHERE tenant_id=$1 RETURNING aggregate_id", [tenantA])).rowCount, 0);
    });
    await assert.rejects(database.tenantTransaction(tenantA, "READ COMMITTED", (client) => client.query(
      "INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES($1,'repo-b','pool-agg','test',1,'{}')", [tenantA]).then(() => undefined)), /aggregates_one_repository_per_id/);
    assert.equal((await database.pool.query("SELECT * FROM aggregates WHERE tenant_id=$1", [tenantA])).rowCount, 0, "SET LOCAL must reset on pooled connection release");
  } finally { await database.close(); }
});

test("inbox uniqueness makes concurrent physical redelivery one logical effect", { skip: !url }, async () => {
  const eventId = "0198a41d-2c00-7000-8000-000000000002";
  const cleanup = new Client({ connectionString: url }); await cleanup.connect(); await cleanup.query("DELETE FROM inbox WHERE event_id=$1", [eventId]); await cleanup.end();
  const contenders = await Promise.allSettled(Array.from({ length: 32 }, async () => {
    const client = new Client({ connectionString: url }); await client.connect();
    try { await client.query("BEGIN"); await client.query("SET LOCAL ROLE agentics_app"); await client.query("SELECT set_config('app.tenant_id','tenant-a',true)");
      const inserted = await client.query("INSERT INTO inbox(tenant_id,consumer,event_id,payload_digest) VALUES('tenant-a','consumer-a',$1,$2) ON CONFLICT DO NOTHING RETURNING event_id", [eventId, "a".repeat(64)]);
      await client.query("COMMIT"); return inserted.rowCount;
    } finally { await client.end(); }
  }));
  assert.equal(contenders.filter((item) => item.status === "fulfilled" && item.value === 1).length, 1);
});
