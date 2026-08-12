import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import pg from "pg";
import { PostgresPersistence } from "../dist/persistence/postgres.js";
import { PostgresBudgetAuthority } from "../dist/infrastructure/governance/postgres-budget-authority.js";
import { repositoryId, tenantId } from "../dist/index.js";

const exec = promisify(execFile);
const configureLedgerDatabase = value => { const url=new URL(value); process.env.PGHOST=url.hostname;process.env.PGPORT=url.port;process.env.PGUSER=decodeURIComponent(url.username);process.env.PGPASSWORD=decodeURIComponent(url.password);process.env.PGDATABASE=url.pathname.slice(1);process.env.DATABASE_POOL_SIZE="40"; };

test("ledger.reserve.behavior: 100 distinct saga IDs share the real authoritative organization ceiling", { skip: !process.env.TEST_DATABASE_URL, timeout: 120_000 }, async t => {
  await exec("node", ["scripts/build-governance-authorities.mjs"], { maxBuffer:16_000_000 });
  const evidence=JSON.parse(await readFile("reports/governance-authority-builds.json","utf8"));
  const built=evidence.authorities.find(item=>item.name==="agentics-usage-ledger"); assert.equal(built.status,"BUILT");
  configureLedgerDatabase(process.env.TEST_DATABASE_URL); const ledgerRoot=dirname(built.artifact);
  const upstream=await import(join(ledgerRoot,"ledger/index.js")); const upstreamDb=await import(join(ledgerRoot,"db/index.js")); upstreamDb.initDb();
  const setup=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:2}); const organizationId=`budget-${randomUUID()}`;
  await setup.query(`CREATE TABLE IF NOT EXISTS organizations(organization_id text PRIMARY KEY,name text NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS ledger_entries(entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,user_id text,entry_type text NOT NULL,amount numeric(20,6) NOT NULL,balance_after numeric(20,6) NOT NULL,idempotency_key text NOT NULL,correlation_id text,service text,run_id text,created_at timestamptz NOT NULL DEFAULT now(),created_by text NOT NULL,metadata jsonb NOT NULL,checksum text NOT NULL,UNIQUE(organization_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS reservations(reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,user_id text,amount numeric(20,6) NOT NULL,expires_at timestamptz NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),consumed_at timestamptz,cancelled_at timestamptz,correlation_id text,idempotency_key text NOT NULL,created_by text NOT NULL,UNIQUE(organization_id,idempotency_key));`);
  await setup.query("INSERT INTO organizations VALUES($1,'acceptance','active',now())",[organizationId]);
  await upstream.grantCredits({organization_id:organizationId,amount:"100.000000",reason:"acceptance ceiling",idempotency_key:randomUUID(),actor:"acceptance"});
  const database=new PostgresPersistence({connectionString:process.env.TEST_DATABASE_URL,maxConnections:30,statementTimeoutMs:15_000,lockTimeoutMs:10_000,enforceRuntimeRole:false});
  t.after(async()=>{await database.close();await upstreamDb.closeDb();await setup.query("DELETE FROM reservations WHERE organization_id=$1",[organizationId]);await setup.query("DELETE FROM ledger_entries WHERE organization_id=$1",[organizationId]);await setup.query("DELETE FROM organizations WHERE organization_id=$1",[organizationId]);await setup.end();});
  const ledger={reserve:async input=>{const value=await upstream.reserveCredits({organization_id:input.organizationId,amount:input.amount,ttl_seconds:input.ttlSeconds,idempotency_key:input.idempotencyKey,actor:input.actor,correlation_id:input.correlationId});const balance=await upstream.getBalance(input.organizationId);return {reservationId:value.reservation_id,status:value.status,amount:value.amount,expiresAt:new Date(value.expires_at).toISOString(),balanceAuthority:{authority:"agentics-usage-ledger",organizationId:balance.organization_id,currentBalance:balance.current_balance,reservedAmount:balance.reserved_amount,availableBalance:balance.available_balance,observedAt:new Date(balance.as_of).toISOString()}};},consume:async()=>{throw new Error("unused");},cancel:async()=>{throw new Error("unused");}};
  const authority=new PostgresBudgetAuthority(database,ledger); const tenant=tenantId(`tenant-${randomUUID()}`),repository=repositoryId("repo-budget");
  const forged=new PostgresBudgetAuthority(database,{...ledger,reserve:async input=>({reservationId:"forged",status:"active",amount:input.amount,expiresAt:new Date(Date.now()+60_000).toISOString(),balanceAuthority:{authority:"agentics-usage-ledger",organizationId:"attacker-org",currentBalance:"999999.000000",reservedAmount:"1.000000",availableBalance:"999998.000000",observedAt:new Date().toISOString()}})});
  await assert.rejects(forged.reserve({tenantId:tenant,repositoryId:repository,organizationId,amount:"1",ttlSeconds:300,idempotencyKey:randomUUID(),actor:"attacker",correlationId:"forged-ceiling"},new AbortController().signal),/BALANCE_AUTHORITY_INVALID/);
  const requests=Array.from({length:100},(_,index)=>({tenantId:tenant,repositoryId:repository,organizationId,amount:"1",ttlSeconds:300,idempotencyKey:randomUUID(),actor:"acceptance",correlationId:`hold-${index}`}));
  const held=await Promise.all(requests.map(request=>authority.reserve(request,new AbortController().signal))); assert.equal(new Set(held.map(item=>item.reservationId)).size,100);
  assert.equal((await upstream.getBalance(organizationId)).available_balance,"0.000000");
  await assert.rejects(authority.reserve({...requests[0],idempotencyKey:randomUUID(),correlationId:"over-ceiling"},new AbortController().signal),/INSUFFICIENT_CREDITS|Insufficient/);
});
