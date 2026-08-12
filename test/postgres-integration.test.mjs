import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;

test("PostgreSQL 16 migrations, FORCE RLS and append-only events execute on real database", { skip: !url }, async () => {
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    await admin.query("DELETE FROM domain_events WHERE tenant_id='tenant-a' AND aggregate_id='agg-a'; DELETE FROM aggregates WHERE tenant_id='tenant-a' AND aggregate_id='agg-a'");
    assert.match((await admin.query("SHOW server_version_num")).rows[0].server_version_num, /^16/);
    const flags = await admin.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)", [["aggregates","domain_events","outbox","inbox"]]);
    assert.equal(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity), true);
    await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE agentics_app"); await admin.query("SELECT set_config('app.tenant_id','tenant-a',true)");
    await admin.query("INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES('tenant-a','repo-a','agg-a','test',1,'{}')");
    await admin.query("COMMIT");
    await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE agentics_app"); await admin.query("SELECT set_config('app.tenant_id','tenant-b',true)");
    assert.equal((await admin.query("SELECT * FROM aggregates WHERE tenant_id='tenant-a'")).rowCount, 0);
    await admin.query("ROLLBACK");
    await admin.query("BEGIN"); await admin.query("SET LOCAL ROLE agentics_app"); await admin.query("SELECT set_config('app.tenant_id','tenant-a',true)");
    const eventId = "0198a41d-2c00-7000-8000-000000000001";
    await admin.query("INSERT INTO domain_events(tenant_id,repository_id,aggregate_id,event_id,aggregate_version,event_type,envelope,occurred_at) VALUES('tenant-a','repo-a','agg-a',$1,1,'Tested','{}','2026-08-12T00:00:00Z')", [eventId]);
    await assert.rejects(admin.query("UPDATE domain_events SET event_type='Changed' WHERE event_id=$1", [eventId]), /append-only|permission denied/);
    await admin.query("ROLLBACK");
  } finally { await admin.end(); }
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
