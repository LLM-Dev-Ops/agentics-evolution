import pg from "pg";
const { Client } = pg;
const [stage, tenant, eventId] = process.argv.slice(2);
const client = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await client.connect();
const envelope = { envelopeSchema: "agentics.evolution-envelope/v1", schemaVersion: 1, id: eventId, type: "CrashTested", tenantId: tenant,
  repositoryId: "repo-crash", aggregateId: "aggregate-crash", cycleId: "cycle-crash", actorId: "actor-crash",
  occurredAt: "2026-08-12T00:00:00.000Z", causationId: "0198a41d-2c00-7000-8000-100000000001",
  correlationId: "0198a41d-2c00-7000-8000-100000000002", idempotencyKey: "0198a41d-2c00-7000-8000-100000000003",
  policyEpoch: 1, sourceRef: { objectFormat: "sha1", commit: "a".repeat(40), dirtySnapshot: null }, evidence: [], payload: {} };
await client.query("BEGIN");
await client.query("INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES($1,'repo-crash','aggregate-crash','crash',1,'{}')", [tenant]);
await client.query("INSERT INTO domain_events(tenant_id,repository_id,aggregate_id,event_id,aggregate_version,event_type,envelope,occurred_at) VALUES($1,'repo-crash','aggregate-crash',$2,1,'CrashTested',$3,$4)", [tenant, eventId, envelope, envelope.occurredAt]);
await client.query("INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope) VALUES($1,$2,'repo-crash','aggregate-crash','evolution.events.v1',$3,$4)", [tenant, eventId, `${tenant}/repo-crash/aggregate-crash`, envelope]);
if (stage === "before-commit") { process.stdout.write("BARRIER\n"); await new Promise(() => {}); }
await client.query("COMMIT");
process.stdout.write("COMMITTED\n");
await new Promise(() => {});
