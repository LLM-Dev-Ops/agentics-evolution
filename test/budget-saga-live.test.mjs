import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PostgresPersistence } from "../dist/persistence/postgres.js";
import { PostgresBudgetAuthority } from "../dist/infrastructure/governance/postgres-budget-authority.js";
import { repositoryId, tenantId } from "../dist/index.js";

test("budget saga concurrent reserve converges and consume is idempotent with one outbox transition", { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const database = new PostgresPersistence({ connectionString: process.env.TEST_DATABASE_URL, maxConnections: 20, statementTimeoutMs: 10_000, lockTimeoutMs: 5_000, enforceRuntimeRole: false }); t.after(() => database.close());
  const tenant = tenantId("tenant-a"), repository = repositoryId("repo-a"), key = randomUUID(), reservationId = `reservation-${key}`;
  const ledger = { reserve: async input => ({ reservationId, status: "active", amount: input.amount, expiresAt: new Date(Date.now()+60_000).toISOString() }),
    consume: async input => ({ entryId: `entry-${input.reservationId}`, amount: input.actualAmount }), cancel: async input => ({ reservationId: input.reservationId, status: "cancelled", amount: "10", expiresAt: new Date().toISOString() }) };
  const authority = new PostgresBudgetAuthority(database, ledger); const request = { tenantId: tenant, repositoryId: repository, organizationId: "org-a", amount: "10", ttlSeconds: 60, idempotencyKey: key, actor: "worker", correlationId: randomUUID() };
  const results = await Promise.all(Array.from({ length: 20 }, () => authority.reserve(request, new AbortController().signal)));
  assert.equal(new Set(results.map(x => x.reservationId)).size, 1);
  const consumeKey = randomUUID(); await Promise.all([authority.consume({ tenantId:tenant,repositoryId:repository,reservationId,idempotencyKey:consumeKey,actor:"worker",actualAmount:"7" },new AbortController().signal), authority.consume({ tenantId:tenant,repositoryId:repository,reservationId,idempotencyKey:consumeKey,actor:"worker",actualAmount:"7" },new AbortController().signal)]);
  const row = await database.tenantTransaction(tenant,"READ COMMITTED",async client => (await client.query("SELECT status,actual_amount FROM budget_reservation_sagas WHERE tenant_id=$1 AND repository_id=$2 AND idempotency_key=$3",[tenant,repository,key])).rows[0]);
  assert.deepEqual(row,{status:"CONSUMED",actual_amount:"7"});
});
