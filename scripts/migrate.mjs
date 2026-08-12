import pg from "pg";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for release-job migrations");
const client = new Client({ connectionString }); await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(719307130031::bigint)");
  const migrations = (await readdir("migrations")).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  for (const file of migrations) {
    const sql = await readFile(`migrations/${file}`, "utf8");
    const version = Number(file.split("_")[0]);
    const checksum = createHash("sha256").update(sql).digest("hex");
    const ledger = await client.query("SELECT checksum FROM schema_migrations WHERE version=$1", [version]).catch(() => ({ rowCount: 0, rows: [] }));
    if (ledger.rowCount) { if (ledger.rows[0].checksum !== checksum) throw new Error(`migration checksum drift: ${file}`); continue; }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      if (process.env.AGENTICS_MIGRATION_BARRIER_AFTER_SQL === String(version)) {
        process.stdout.write(`MIGRATION_BARRIER_${version}\n`);
        await new Promise(() => {});
      }
      await client.query("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", [version, checksum]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    console.log(`applied ${file} ${checksum}`);
  }
} finally { await client.query("SELECT pg_advisory_unlock(719307130031::bigint)").catch(() => undefined); await client.end(); }
