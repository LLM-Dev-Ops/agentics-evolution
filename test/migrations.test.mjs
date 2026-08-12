import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;

function migrate(databaseUrl, extraEnv = {}) {
  return spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, ...extraEnv }, encoding: "utf8"
  });
}
function app(databaseUrl, script, mode, aggregateId) {
  return spawnSync(process.execPath, [script, mode, aggregateId], { cwd: process.cwd(), env: { ...process.env, TEST_DATABASE_URL: databaseUrl }, encoding: "utf8" });
}

async function interruptAfterSql(databaseUrl, version) {
  const child = spawn(process.execPath, ["scripts/migrate.mjs"], { cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, AGENTICS_MIGRATION_BARRIER_AFTER_SQL: String(version) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    let output = ""; let errors = "";
    child.stdout.on("data", (data) => { output += data; if (output.includes(`MIGRATION_BARRIER_${version}`)) resolve(); });
    child.stderr.on("data", (data) => { errors += data; }); child.on("error", reject);
    child.on("exit", (code) => { if (!output.includes(`MIGRATION_BARRIER_${version}`)) reject(new Error(`migration exited ${code}: ${errors}`)); });
    setTimeout(() => reject(new Error(`migration barrier timeout: ${output} ${errors}`)), 10_000).unref();
  });
  child.kill("SIGKILL"); if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
}

test("every release migration survives interruption and rejects checksum drift", { skip: !url }, async () => {
  const databaseName = `agentics_migration_${process.pid}_${Date.now()}`;
  assert.match(databaseName, /^[a-z0-9_]+$/);
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const databaseUrl = new URL(url); databaseUrl.pathname = `/${databaseName}`;
    for (let version = 1; version <= 8; version++) {
      const prior = migrate(databaseUrl.toString(), { AGENTICS_MIGRATION_MAX_VERSION: String(version - 1) }); assert.equal(prior.status, 0, prior.stderr);
      await interruptAfterSql(databaseUrl.toString(), version);
      const resumed = migrate(databaseUrl.toString(), { AGENTICS_MIGRATION_MAX_VERSION: String(version) }); assert.equal(resumed.status, 0, resumed.stderr);
    }
    const fresh = migrate(databaseUrl.toString()); assert.equal(fresh.status, 0, fresh.stderr);
    const repeat = migrate(databaseUrl.toString()); assert.equal(repeat.status, 0, repeat.stderr);
    const database = new Client({ connectionString: databaseUrl.toString() }); await database.connect();
    try { await database.query("UPDATE schema_migrations SET checksum=$1 WHERE version=1", ["0".repeat(64)]); }
    finally { await database.end(); }
    const drift = migrate(databaseUrl.toString()); assert.notEqual(drift.status, 0); assert.match(`${drift.stderr}${drift.stdout}`, /checksum drift/);
  } finally {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]);
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`); await admin.end();
  }
});

test("expanded schema permits mixed old and new writers over a production-shaped fixture", { skip: !url }, async () => {
  const databaseName = `agentics_mixed_${process.pid}_${Date.now()}`; assert.match(databaseName, /^[a-z0-9_]+$/);
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`); const databaseUrl = new URL(url); databaseUrl.pathname = `/${databaseName}`;
    const oldSchema = migrate(databaseUrl.toString(), { AGENTICS_MIGRATION_MAX_VERSION: "3" }); assert.equal(oldSchema.status, 0, oldSchema.stderr);
    const database = new Client({ connectionString: databaseUrl.toString() }); await database.connect();
    try {
      await database.query(`INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state)
        SELECT 'mixed','repo','aggregate-'||number,'old-writer',1,jsonb_build_object('generation','old') FROM generate_series(1,10000) number`);
      const expanded = migrate(databaseUrl.toString()); assert.equal(expanded.status, 0, expanded.stderr);
      const predecessor = "test/fixtures/predecessor-v3-app.mjs"; const current = "test/fixtures/current-v8-app.mjs";
      const [oldWrite, newWrite] = [app(databaseUrl.toString(), predecessor, "write", "old-live"), app(databaseUrl.toString(), current, "write", "new-live")];
      assert.equal(oldWrite.status, 0, oldWrite.stderr); assert.equal(newWrite.status, 0, newWrite.stderr);
      const [oldReadsNew, newReadsOld] = [app(databaseUrl.toString(), predecessor, "read", "new-live"), app(databaseUrl.toString(), current, "read", "old-live")];
      assert.equal(oldReadsNew.status, 0, oldReadsNew.stderr); assert.equal(newReadsOld.status, 0, newReadsOld.stderr);
      assert.equal((await database.query("SELECT count(*)::int AS count FROM aggregates WHERE tenant_id='mixed'")).rows[0].count, 10002);
    } finally { await database.end(); }
  } finally {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]); await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`); await admin.end();
  }
});
