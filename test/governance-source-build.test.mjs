import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
const exec = promisify(execFile);

test("exact governance sources verify trees, build when dependency-complete, and expose real ledger validation", { timeout: 120_000 }, async () => {
  await exec("node", ["scripts/build-governance-authorities.mjs"], { maxBuffer: 16_000_000 });
  const evidence = JSON.parse(await readFile("reports/governance-authority-builds.json", "utf8"));
  assert.equal(evidence.authorities.length, 3);
  for (const authority of evidence.authorities) { assert.match(authority.commit, /^[a-f0-9]{40}$/); assert.match(authority.sourceTree, /^[a-f0-9]{40}$/); }
  const ledger = evidence.authorities.find(({ name }) => name === "agentics-usage-ledger"); assert.equal(ledger.status, "BUILT");
  const validation = await import(join(dirname(ledger.artifact), "validation/index.js"));
  assert.equal(validation.validatePositiveAmount("10.25", "amount"), "10.250000");
  assert.throws(() => validation.validatePositiveAmount("-1", "amount"));
  const policy = evidence.authorities.find(({ name }) => name === "agentics-policy-engine"); assert.equal(policy.status, "BUILT");
  const { PolicyEngine } = await import(join(dirname(policy.artifact), "core/engine/policy-engine.js"));
  const engine = new PolicyEngine([{ metadata:{id:"deny",name:"deny",version:"1",namespace:"test",priority:100},status:"active",rules:[{id:"r",name:"deny writes",enabled:true,condition:{operator:"eq",field:"metadata.action",value:"repository.write"},action:{decision:"deny",reason:"blocked"}}] }]);
  const policyResult = await engine.evaluate({ requestId:"contract",context:{metadata:{action:"repository.write"}},trace:true });
  assert.equal(policyResult.decision.allowed,false); assert.equal(policyResult.decision.decision,"deny");
  const enforcement = evidence.authorities.find(({ name }) => name === "agentics-enforcement"); assert.equal(enforcement.status, "BUILD_DEPENDENCY_UNAVAILABLE");
});
