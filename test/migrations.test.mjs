import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";
const { Client } = pg;
const url = process.env.TEST_DATABASE_URL;

function migrate(databaseUrl) {
  return spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8"
  });
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

test("release migrations are fresh-install idempotent and reject checksum drift", { skip: !url }, async () => {
  const databaseName = `agentics_migration_${process.pid}_${Date.now()}`;
  assert.match(databaseName, /^[a-z0-9_]+$/);
  const admin = new Client({ connectionString: url }); await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const databaseUrl = new URL(url); databaseUrl.pathname = `/${databaseName}`;
    await interruptAfterSql(databaseUrl.toString(), 1);
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
