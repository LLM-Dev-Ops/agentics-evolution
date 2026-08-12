import { PostgresPersistence } from "../../dist/index.js";
const [mode, aggregateId] = process.argv.slice(2); const database = new PostgresPersistence({ connectionString: process.env.TEST_DATABASE_URL,
  maxConnections: 2, statementTimeoutMs: 5_000, lockTimeoutMs: 1_000, enforceRuntimeRole: false });
try {
  if (mode === "write") await database.tenantTransaction("mixed", "SERIALIZABLE", (client) => client.query(
    "INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES('mixed','repo',$1,'current-v8',1,$2)", [aggregateId, { contractVersion: 8 }]).then(() => undefined));
  else if (mode === "read") await database.tenantTransaction("mixed", "READ COMMITTED", async (client) => {
    const row = await client.query("SELECT version,state FROM aggregates WHERE tenant_id='mixed' AND repository_id='repo' AND aggregate_id=$1", [aggregateId]);
    if (row.rowCount !== 1 || Number(row.rows[0].version) !== 1) throw new Error("CURRENT_READ_INCOMPATIBLE");
  }); else throw new Error("UNKNOWN_CURRENT_MODE");
} finally { await database.close(); }
