import pg from "pg";
import { writeFile } from "node:fs/promises";
const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
try {
  const version = await client.query("SHOW server_version_num");
  if (!String(version.rows[0].server_version_num).startsWith("16")) throw new Error("PostgreSQL 16 required");
  const rls = await client.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1) ORDER BY relname", [["aggregates","domain_events","command_idempotency","outbox","inbox","dead_letters","critical_resources"]]);
  if (rls.rowCount !== 7 || rls.rows.some((row) => !row.relrowsecurity || !row.relforcerowsecurity)) throw new Error("FORCE RLS missing");
  const migrations = await client.query("SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version");
  await writeFile("reports/prompt-03-postgres.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-03-postgres/v1", serverVersion: version.rows[0].server_version_num, rls: rls.rows, migrations: migrations.rows, passed: true }, null, 2)}\n`);
} finally { await client.end(); }
