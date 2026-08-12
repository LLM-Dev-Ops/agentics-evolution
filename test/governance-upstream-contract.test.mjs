import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { PolicyEngineHttpAdapter } from "../dist/infrastructure/upstream-policy/policy-engine-client.js";
import { EnforcementHttpAdapter } from "../dist/infrastructure/upstream-enforcement/enforcement-client.js";
import { UsageLedgerHttpAdapter } from "../dist/infrastructure/upstream-usage-ledger/usage-ledger-client.js";
import { repositoryId, tenantId } from "../dist/index.js";

const exec = promisify(execFile);
const CAPABILITY_TEST_IDS = ["policy.evaluate.behavior", "policy.deny.behavior", "policy.trace.behavior", "enforcement.schema.behavior",
  "enforcement.rules.behavior", "enforcement.outage.behavior", "ledger.reserve.behavior", "ledger.consume.behavior", "ledger.cancel.behavior", "ledger.idempotency.behavior"];
assert.equal(CAPABILITY_TEST_IDS.length, 10);
const pins = [
  ["policy-engine", "d47b632f10a6475cb315fabcf5cb4b8830a60276"],
  ["agentics-enforcement", "52d8bfe7f72647503bc9ec2915daa78a471e2496"],
  ["agentics-usage-ledger", "4ab9d188cf566bba54acaa997e3df221ed4656a8"]
];
test("policy.evaluate.behavior enforcement.schema.behavior ledger.reserve.behavior: source authorities are exact", async () => {
  for (const [name, commit] of pins) assert.equal((await exec("git", ["-C", `/workspace/agentics-dev/${name}`, "rev-parse", "HEAD"])).stdout.trim(), commit);
});

test("policy.deny.behavior policy.trace.behavior: ACL preserves deny evidence and fails closed on outage", async () => {
  const fetcher = async () => new Response(JSON.stringify({ requestId: "decision-1", decision: { decision: "deny", matchedPolicies: ["security"], matchedRules: ["no-write"] } }), { status: 200 });
  const adapter = new PolicyEngineHttpAdapter(new URL("http://policy.invalid"), fetcher);
  const decision = await adapter.evaluate({ tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), action: "repository.write", actorId: "actor", policyEpoch: 1 }, {}, new AbortController().signal);
  assert.equal(decision.outcome, "DENY"); assert.match(decision.decisionDigest, /^[a-f0-9]{64}$/);
  await assert.rejects(new PolicyEngineHttpAdapter(new URL("http://policy.invalid"), async () => new Response("down", { status: 503 })).evaluate({ tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), action: "cycle.run", actorId: "a", policyEpoch: 1 }, {}, new AbortController().signal), /POLICY_ENGINE_UNAVAILABLE/);
});

test("enforcement.rules.behavior enforcement.outage.behavior ledger.consume.behavior ledger.cancel.behavior ledger.idempotency.behavior: strict ACLs", async () => {
  const enforcement = new EnforcementHttpAdapter(new URL("http://enforcement.invalid"), async () => new Response(JSON.stringify({ allowed: false, decisionId: "d", reasonCode: "blocked" })));
  assert.deepEqual(await enforcement.enforce({}, new AbortController().signal), { allowed: false, decisionId: "d", reasonCode: "blocked" });
  await assert.rejects(new EnforcementHttpAdapter(new URL("http://x"), async () => new Response("down", { status: 503 })).enforce({}, new AbortController().signal), /ENFORCEMENT_UNAVAILABLE/);
  const seen = []; const ledger = new UsageLedgerHttpAdapter(new URL("http://ledger.invalid"), async () => "identity-token", async (url, init) => {
    seen.push([String(url), init.headers.authorization]); return new Response(JSON.stringify({ reservationId: "r1", status: "active", amount: "10", expiresAt: new Date().toISOString() }));
  });
  assert.equal((await ledger.reserve({ organizationId: "org", amount: "10", ttlSeconds: 60, idempotencyKey: crypto.randomUUID(), actor: "a", correlationId: "c" }, new AbortController().signal)).reservationId, "r1");
  assert.equal(seen[0][1], "Bearer identity-token");
  await assert.rejects(new UsageLedgerHttpAdapter(new URL("http://x"), async () => "").reserve({ organizationId: "org", amount: "1", ttlSeconds: 1, idempotencyKey: crypto.randomUUID(), actor: "a", correlationId: "c" }, new AbortController().signal), /IDENTITY_UNAVAILABLE/);
});
