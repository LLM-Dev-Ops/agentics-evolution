import pg from "pg";
import { writeFile } from "node:fs/promises";
const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
try {
  const version = await client.query("SHOW server_version_num");
  if (!String(version.rows[0].server_version_num).startsWith("16")) throw new Error("PostgreSQL 16 required");
  const rlsTables = ["aggregates","domain_events","command_idempotency","outbox","inbox","dead_letters","critical_resources","local_transport_messages","consumer_progress"];
  const rls = await client.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1) ORDER BY relname", [rlsTables]);
  if (rls.rowCount !== rlsTables.length || rls.rows.some((row) => !row.relrowsecurity || !row.relforcerowsecurity)) throw new Error("FORCE RLS missing");
  const policies = await client.query("SELECT tablename,qual,with_check FROM pg_policies WHERE policyname='tenant_isolation' AND tablename=ANY($1) ORDER BY tablename", [rlsTables]);
  if (policies.rowCount !== rlsTables.length || policies.rows.some((row) => !row.qual?.includes("app.tenant_id") || !row.with_check?.includes("app.tenant_id"))) throw new Error("tenant RLS policy missing");
  const roles = await client.query("SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname", [["agentics_app", "agentics_relay"]]);
  if (roles.rowCount !== 2 || roles.rows.some((role) => role.rolsuper || role.rolbypassrls || role.rolcanlogin)) throw new Error("unsafe runtime database role");
  const migrations = await client.query("SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version");
  await writeFile("reports/prompt-03-postgres.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-03-postgres/v1", serverVersion: version.rows[0].server_version_num,
    rls: rls.rows, policies: policies.rows, roles: roles.rows, migrations: migrations.rows, passed: true }, null, 2)}\n`);
} finally { await client.end(); }
