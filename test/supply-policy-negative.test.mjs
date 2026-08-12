import test from "node:test";
import assert from "node:assert/strict";
import { dependencyPolicyFailures, maintainerPolicyFailures, vulnerabilityPolicyFailures } from "../scripts/lib/supply-policy.mjs";

const policy = { registryOrigin: "https://registry.npmjs.org", approvedMaintainers: ["ruvnet <ruv@ruv.net>"] };
const valid = { resolved: "https://registry.npmjs.org/ruflo/-/ruflo-3.38.0.tgz", integrity: "sha512-trusted" };

test("malicious dependency without integrity is rejected", () => {
  assert.match(dependencyPolicyFailures("ruflo", { ...valid, integrity: undefined }, policy).join("\n"), /missing trusted/);
});

test("dependency provenance registry drift is rejected", () => {
  const compromised = { ...valid, resolved: "https://evil.example/ruflo.tgz" };
  assert.match(dependencyPolicyFailures("ruflo", compromised, policy).join("\n"), /provenance drifted/);
});

test("maintainer takeover is rejected", () => {
  const compromised = ["attacker <bad@example.test>"];
  assert.match(maintainerPolicyFailures("ruflo", compromised, policy).join("\n"), /maintainer set drifted/);
});

test("approved registry provenance and maintainer identity pass", () => {
  assert.deepEqual(dependencyPolicyFailures("ruflo", valid, policy), []);
  assert.deepEqual(maintainerPolicyFailures("ruflo", policy.approvedMaintainers, policy), []);
});

test("a vulnerable selected native artifact blocks acceptance", () => {
  const audit = { metadata: { vulnerabilities: { high: 1, critical: 0 } } };
  assert.match(vulnerabilityPolicyFailures("selected platform graph", audit).join("\n"), /1 high/);
});
