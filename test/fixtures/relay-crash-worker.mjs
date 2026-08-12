import { OutboxRelay, PostgresLocalTransport, PostgresPersistence } from "../../dist/index.js";
const [stage, tenant] = process.argv.slice(2); const connectionString = process.env.TEST_DATABASE_URL;
const database = new PostgresPersistence({ connectionString, maxConnections: 2, statementTimeoutMs: 5_000, lockTimeoutMs: 1_000, enforceRuntimeRole: false });
const transport = new PostgresLocalTransport(database); const relay = new OutboxRelay(database, transport);
const leases = await relay.claim(tenant, 1); if (leases.length !== 1) throw new Error("EXPECTED_ONE_LEASE");
if (stage === "after-claim") { process.stdout.write("CLAIMED\n"); await new Promise(() => {}); }
await transport.publish(leases[0].topic, { envelope: leases[0].envelope, orderingKey: leases[0].orderingKey,
  attributes: { eventId: leases[0].eventId, correlationId: leases[0].envelope.correlationId, causationId: leases[0].envelope.causationId } });
process.stdout.write("BROKER_ACCEPTED\n"); await new Promise(() => {});
