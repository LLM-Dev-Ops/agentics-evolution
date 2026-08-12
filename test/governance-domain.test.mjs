import assert from "node:assert/strict";
import test from "node:test";
import { money } from "../dist/index.js";
import { approveAuthorization, consumeAuthorization, createDelegation, intersectEnvelopes, isEnvelopeSubset, normalizeEnvelope,
  requestAuthorization, revokeDelegation, tenantSecurityProfile, terminateAuthorization } from "../dist/contexts/governance/domain/index.js";

const envelope = (overrides = {}) => ({ action: "promotion.authorize", tenantId: "tenant-a", repositories: ["repo-a", "repo-b"], paths: ["src/*"], tools: ["git"],
  network: ["https://api.example.com:443"], providers: ["private"], models: ["model-a"], regions: ["us-central1"], classification: "RESTRICTED",
  spend: money(10_000n, "USD"), concurrency: 4, expiresAt: "2030-01-01T00:00:00Z", depth: 3, uses: 2, ...overrides });

test("normalization is deterministic and rejects traversal/ambiguous paths", () => {
  assert.deepEqual(normalizeEnvelope(envelope({ repositories: ["repo-b", "repo-a", "repo-a"] })).repositories, ["repo-a", "repo-b"]);
  assert.throws(() => normalizeEnvelope(envelope({ paths: ["../secret"] })), /INVALID_PATH/);
  assert.throws(() => normalizeEnvelope(envelope({ paths: ["/absolute"] })), /INVALID_PATH/);
});

test("intersection shrinks every capability dimension", () => {
  const parent = envelope(); const child = envelope({ repositories: ["repo-a"], paths: [], tools: [], network: [], providers: ["private"], models: [], regions: ["us-central1"],
    classification: "CONFIDENTIAL", spend: money(500n, "USD"), concurrency: 1, expiresAt: "2029-01-01T00:00:00Z", depth: 1, uses: 1 });
  assert.equal(isEnvelopeSubset(child, parent), true); assert.deepEqual(intersectEnvelopes(parent, child), normalizeEnvelope(child));
  for (const expanded of [
    { repositories: ["repo-c"] }, { paths: ["other/*"] }, { tools: ["shell"] }, { network: ["https://evil.test:443"] }, { providers: ["public"] },
    { models: ["other"] }, { regions: ["eu-west1"] }, { spend: money(10_001n, "USD") }, { concurrency: 5 }, { expiresAt: "2031-01-01T00:00:00Z" }, { depth: 4 }, { uses: 3 }
  ]) assert.equal(isEnvelopeSubset(envelope(expanded), parent), false);
});

test("authorization enforces separation, shrinking, replay, expiry and revocation", () => {
  const request = requestAuthorization({ id: "auth-1", requester: "alice", candidateDigest: "ab".repeat(32), evidenceDigest: "cd".repeat(32), environment: "prod",
    expectedChampionVersion: 1, policyEpoch: "epoch-1", envelope: envelope(), expiresAt: "2030-01-01T00:00:00Z", maxUses: 1 });
  assert.throws(() => approveAuthorization(request, "alice", envelope()), /APPROVAL_REJECTED/);
  assert.throws(() => approveAuthorization(request, "bob", envelope({ repositories: ["repo-c"] })), /APPROVAL_REJECTED/);
  const approved = approveAuthorization(request, "bob", envelope({ repositories: ["repo-a"] })); const consumed = consumeAuthorization(approved, "2029-01-01T00:00:00Z");
  assert.equal(consumed.state, "CONSUMED"); assert.throws(() => consumeAuthorization(consumed, "2029-01-01T00:00:01Z"), /NOT_CONSUMABLE/);
  assert.equal(terminateAuthorization(approved, "REVOKED").state, "REVOKED");
  assert.throws(() => consumeAuthorization(approved, "2030-01-01T00:00:00Z"), /NOT_CONSUMABLE/);
});

test("delegation strictly decreases depth and cannot expand or revive", () => {
  const parent = createDelegation("parent", envelope()); const childEnvelope = envelope({ repositories: ["repo-a"], depth: 2 });
  const child = createDelegation("child", childEnvelope, parent); assert.equal(child.parentId, "parent");
  assert.throws(() => createDelegation("expanded", envelope({ depth: 3 }), parent), /EXPANSION/);
  const revoked = revokeDelegation(parent); assert.throws(() => createDelegation("late", childEnvelope, revoked), /EXPANSION/);
});

test("tenant security profile enforces residency, opt-out and retention minima", () => {
  const retention = { SCRATCH: 7, RAW_OBSERVATION: 30, CANDIDATE_FAILURE: 90, SUCCESSFUL_LINEAGE: 400, SECURITY_AUDIT: 400 };
  assert.equal(tenantSecurityProfile({ tenantId: "tenant-a", region: "us-central1", maximumClassification: "RESTRICTED", providers: ["private"], trainingOptOut: true, retention }).region, "us-central1");
  assert.throws(() => tenantSecurityProfile({ tenantId: "tenant-a", region: "us-central1", maximumClassification: "RESTRICTED", providers: ["private"], trainingOptOut: true, retention: { ...retention, SCRATCH: 6 } }), /RETENTION/);
});

test("seeded 10k shrinking property preserves subset transitivity", () => {
  let seed = 0x5eed1234; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const take = (values) => values.filter(() => random() < .5); const parent = envelope();
  for (let index = 0; index < 10_000; index++) {
    const child = envelope({ repositories: take(parent.repositories), paths: take(parent.paths), tools: take(parent.tools), network: take(parent.network), providers: take(parent.providers), models: take(parent.models), regions: take(parent.regions),
      classification: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"][Math.floor(random() * 4)], spend: money(BigInt(Math.floor(random() * 10_001)), "USD"), concurrency: 1 + Math.floor(random() * 4),
      expiresAt: new Date(Date.parse("2028-01-01") + Math.floor(random() * (Date.parse("2030-01-01") - Date.parse("2028-01-01")))).toISOString(), depth: Math.floor(random() * 4), uses: 1 + Math.floor(random() * 2) });
    const grandchild = intersectEnvelopes(child, envelope({ ...child, repositories: take(child.repositories), spend: money(child.spend.minorUnits / 2n, "USD"), concurrency: 1, depth: 0, uses: 1 }));
    assert.equal(isEnvelopeSubset(child, parent), true); assert.equal(isEnvelopeSubset(grandchild, child), true); assert.equal(isEnvelopeSubset(grandchild, parent), true);
  }
});
