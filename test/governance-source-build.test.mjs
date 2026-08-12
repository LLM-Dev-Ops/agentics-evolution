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
  const policy = evidence.authorities.find(({ name }) => name === "agentics-policy-engine"); assert.equal(policy.status, "SOURCE_LOCKFILE_MISSING");
  const enforcement = evidence.authorities.find(({ name }) => name === "agentics-enforcement"); assert.equal(enforcement.status, "BUILD_DEPENDENCY_UNAVAILABLE");
});
