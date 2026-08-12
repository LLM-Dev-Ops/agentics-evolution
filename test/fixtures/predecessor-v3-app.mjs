import pg from "pg";
const { Client } = pg; const [mode, aggregateId] = process.argv.slice(2); const client = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await client.connect();
try {
  if (mode === "write") await client.query("INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES('mixed','repo',$1,'predecessor-v3',1,$2)", [aggregateId, { contractVersion: 3 }]);
  else if (mode === "read") { const row = await client.query("SELECT version,state FROM aggregates WHERE tenant_id='mixed' AND repository_id='repo' AND aggregate_id=$1", [aggregateId]);
    if (row.rowCount !== 1 || Number(row.rows[0].version) !== 1) throw new Error("PREDECESSOR_READ_INCOMPATIBLE"); }
  else throw new Error("UNKNOWN_PREDECESSOR_MODE");
} finally { await client.end(); }
