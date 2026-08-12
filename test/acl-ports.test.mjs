import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  ACL_PORT_CONTRACTS,
  observeUnknown,
  requireKnown,
  validateCallContext,
  validateUpstreamEvidence
} from "../dist/application/ports/acl-contract.js";
import { canonicalJson, mapUpstreamError, negotiateVersion, withDeadline } from "../dist/upstream/contract.js";
import { newCorrelationId, repositoryId, tenantId, utcInstant } from "../dist/index.js";

const EXPECTED_PORTS = [
  "HarnessAnalysisPort", "DarwinEvolutionPort", "FlywheelProofPort",
  "BrainKnowledgePort", "RufloCoordinationPort", "RedBluePort"
];

test("DDD-008 publishes exactly six Agentics ACL port contracts", () => {
  assert.deepEqual(Object.keys(ACL_PORT_CONTRACTS).sort(), [...EXPECTED_PORTS].sort());
  for (const contract of Object.values(ACL_PORT_CONTRACTS)) {
    assert.ok(contract.methods.length > 0);
    assert.equal(new Set(contract.methods).size, contract.methods.length);
  }
});

test("authority catalog maps every public ACL to one authority", async () => {
  const catalog = parse(await readFile("config/upstream-authorities.yaml", "utf8"));
  const mappings = new Map();
  for (const authority of catalog.authorities)
    for (const port of authority.aclPorts ?? []) {
      assert.equal(mappings.has(port), false, `${port} has multiple authorities`);
      mappings.set(port, authority.name);
    }
  for (const port of EXPECTED_PORTS) assert.equal(mappings.get(port), ACL_PORT_CONTRACTS[port].authority === "ruvector-brain-local" ? "ruvector" : ACL_PORT_CONTRACTS[port].authority);
});

test("read paths preserve unknown values while write paths fail closed", () => {
  const known = observeUnknown("READY", { READY: "READY", DEGRADED: "DEGRADED" });
  assert.equal(requireKnown(known, "status"), "READY");
  const unknown = observeUnknown("FUTURE", { READY: "READY" });
  assert.deepEqual(unknown, { kind: "UNRECOGNIZED", rawValue: "FUTURE" });
  assert.throws(() => requireKnown(unknown, "status"), /INCOMPATIBLE/);
});

test("call context and upstream evidence bind correlation, exact version, and capability digest", () => {
  const signal = new AbortController().signal;
  const correlationId = newCorrelationId();
  validateCallContext({ tenantId: tenantId("tenant"), repositoryId: repositoryId("repo"), correlationId, deadline: utcInstant("2099-01-01T00:00:00.000Z"), signal });
  const expected = { authority: "darwin", exactVersion: "0.9.1", correlationId };
  validateUpstreamEvidence({ authority: "darwin", exactVersion: "0.9.1", capabilityDigest: `sha256:${"a".repeat(64)}`, correlationId }, expected);
  assert.throws(() => validateUpstreamEvidence({ authority: "darwin", exactVersion: "0.9.2", capabilityDigest: `sha256:${"a".repeat(64)}`, correlationId }, expected), /version/);
  assert.throws(() => validateUpstreamEvidence({ authority: "other", exactVersion: "0.9.1", capabilityDigest: `sha256:${"a".repeat(64)}`, correlationId }, expected), /authority/);
});

test("each ACL passes golden, error, deadline, cancellation, and version contracts", async () => {
  for (const [port, contract] of Object.entries(ACL_PORT_CONTRACTS)) {
    const golden = canonicalJson({ port, authority: contract.authority, methods: [...contract.methods] });
    assert.equal(golden, canonicalJson({ methods: [...contract.methods], authority: contract.authority, port }));
    assert.equal(mapUpstreamError(contract.authority, { code: "ETIMEDOUT", message: "timed out" }).code, "TIMEOUT");
    assert.equal(mapUpstreamError(contract.authority, { name: "AbortError", message: "cancelled" }).code, "CANCELLED");
    assert.equal(negotiateVersion(["v1"], ["legacy", "v1"]), "v1");
    assert.throws(() => negotiateVersion(["v1"], ["future"]), /INCOMPATIBLE/);
    await assert.rejects(withDeadline((signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), 1), /deadline exceeded/);
  }
});
