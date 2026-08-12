import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAuthorityCatalog } from "../scripts/authority-catalog.mjs";
import { evaluateProbe } from "../dist/upstream/authority.js";

const FLYWHEEL_CONTRACT_IDS = [
  "flywheel.lineage.behavior", "flywheel.signer.behavior", "flywheel.gate.behavior",
  "flywheel.receipt.behavior", "flywheel.replay.behavior", "flywheel.sequential.behavior"
];
const OTHER_CONTRACT_IDS = [
  "turn-credit.receipt.behavior", "turn-credit.trajectory.behavior", "turn-credit.memory-feedback.behavior",
  "router.route.behavior", "router.calibration.behavior", "router.train.behavior", "router.native.behavior"
];
assert.equal(FLYWHEEL_CONTRACT_IDS.length + OTHER_CONTRACT_IDS.length, 13);

test("authority catalog is complete and lock-bound", async () => {
  const { catalog, failures } = await loadAuthorityCatalog();
  assert.deepEqual(failures, []);
  assert.equal(catalog.authorities.length, 9);
  assert.equal(catalog.sourceAuthorities.length, 1);
  assert.match(catalog.sourceAuthorities[0].commit, /^[a-f0-9]{40}$/);
  assert.match(catalog.sourceAuthorities[0].sourceTree, /^[a-f0-9]{40}$/);
  assert.deepEqual(catalog.hosts.map((host) => host.name).sort(), ["claude-code", "codex"]);
  for (const authority of catalog.authorities) {
    assert.ok(authority.requiredCapabilities.length > 0);
    assert.ok(authority.upstreamAdrs.length > 0);
    assert.match(authority.integrity, /^sha512-/);
  }
});

test("catalog rejects floating versions and incomplete deviations", async () => {
  const original = await readFile("config/upstream-authorities.yaml", "utf8");
  const directory = await mkdtemp(join(tmpdir(), "authority-negative-"));
  const path = join(directory, "catalog.yaml");
  const changed = original
    .replace('version: "3.38.0"', 'version: "latest"')
    .replace("    deviations: []", "    deviations:\n      - owner: platform");
  await writeFile(path, changed);
  try {
    const { failures } = await loadAuthorityCatalog(path);
    assert.ok(failures.some((failure) => failure.includes("version: must be exact")));
    assert.ok(failures.some((failure) => failure.includes("threatAnalysis: required")));
    assert.ok(failures.some((failure) => failure.includes("expiresAt: required")));
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("readiness fails closed on version, integrity, export, and capability drift", () => {
  const verdict = evaluateProbe({
    authority: "darwin",
    requestedVersion: "1.0.0",
    resolvedVersion: "1.0.1",
    requestedIntegrity: "sha512-expected",
    resolvedIntegrity: "sha512-other",
    requiredExports: ["evolve"],
    availableExports: [],
    requiredCapabilities: ["mutation"],
    availableCapabilities: []
  });
  assert.equal(verdict.ready, false);
  assert.deepEqual(verdict.failures, [
    "version mismatch: expected 1.0.0, resolved 1.0.1",
    "integrity mismatch",
    "required export missing: evolve",
    "required capability missing: mutation"
  ]);
});

test("Claude Code host preserves instructions, permissions, and typed hooks", async () => {
  const host = await import("@metaharness/host-claude-code");
  assert.equal(host.HOST_NAME, "claude-code");
  const spec = {
    name: "contract",
    description: "contract fixture",
    systemPrompt: "Preserve this instruction",
    permissions: { allow: ["Read"], deny: ["WebFetch"] },
    hooks: [{ event: "PreToolUse", matcher: "Bash", handler: "mcp:ruflo/pre-tool" }]
  };
  assert.match(host.claudeMd(spec), /Preserve this instruction/);
  const settings = host.settingsFor(spec);
  assert.deepEqual(settings.permissions, spec.permissions);
  assert.deepEqual(settings.hooks.PreToolUse[0].hooks[0], { type: "mcp_tool", server: "ruflo", tool: "pre-tool" });
  assert.equal(host.adapter.name, "claude-code");
});

test("Codex host preserves instructions and renders valid MCP TOML", async () => {
  const host = await import("@metaharness/host-codex");
  assert.equal(host.HOST_NAME, "codex");
  const spec = {
    name: "contract",
    systemPrompt: "Preserve this instruction",
    mcpServers: [{ name: "brain", command: ["node", "server.js"], env: [["MODE", "test"]] }]
  };
  assert.match(host.agentsMarkdown(spec), /Preserve this instruction/);
  assert.match(host.configToml(spec), /\[mcp_servers\.brain\]/);
  assert.match(host.configToml(spec), /command = "node"/);
  assert.equal(host.adapter.name, "codex");
});

test("Flywheel real signer verifies canonical receipts and rejects tampering", async () => {
  const flywheel = await import("@metaharness/flywheel");
  const { canon, makeSigner, verifyReceipt } = flywheel;
  assert.equal(canon({ z: 1, a: 2 }), canon({ a: 2, z: 1 }));
  const signer = makeSigner();
  const receipt = signer.sign({ verdict: "PROMOTED", digest: "sha256:fixture" });
  assert.equal(verifyReceipt(receipt), true);
  assert.equal(verifyReceipt({ ...receipt, payload: { ...receipt.payload, verdict: "REJECTED" } }), false);
  const score = { primary: 0.8, noopRate: 0.2, costPerWin: 1, regressed: false };
  const improved = { primary: 0.9, noopRate: 0.1, costPerWin: 1, regressed: false };
  assert.equal(flywheel.meetsPromotionRule({ baseline: score, candidate: improved }).promote, true);
  assert.equal(flywheel.sequentialEvidence(Array.from({ length: 12 }, (_, index) => ({ itemId: String(index), candidateWon: true, baselineWon: false }))).significant, true);
  const store = new flywheel.InMemoryLineageStore();
  const root = {
    id: "root", generation: 0, parents: [], mutation: null, primaryDelta: 0, anchorScore: null,
    verdict: "ROOT", failureReasons: [], receipt: signer.sign({ id: "root" }), createdAt: "2026-01-01T00:00:00Z"
  };
  await store.append(root);
  assert.deepEqual((await store.walkToRoot("root")).map((commit) => commit.id), ["root"]);
  const replay = flywheel.verifyReplayBundle({
    data_source: "contract", root_id: "root", chain: [root], all_commits: [root],
    lift_curve: [{ generation: 0, primary: 0.8, delta: 0, anchor: null }], gate_fingerprint: null,
    verified_improvements: 0, anchor_surviving_improvements: 0, milestone_reached: false, created_at: "2026-01-01T00:00:00Z"
  });
  assert.equal(replay.pass, true);
});

test("Turn-credit receipt binds trajectory and retrieved evidence", async () => {
  const creditApi = await import("@metaharness/turn-credit");
  const credit = creditApi.processTrajectory({
    evidence: [{ turn: 0, evidence: 0.4, label: "route" }],
    mode: "verifier-delta-proxy",
    prior: 0.5,
    success: true
  });
  const payload = creditApi.buildCreditReceiptPayload({
    credit,
    verifierVersion: "fixture-1.0.0",
    retrievedEvidence: { ids: ["memory-1"] },
    trajectory: [{ role: "assistant", action: "route" }]
  });
  assert.equal(payload.verifierVersion, "fixture-1.0.0");
  assert.match(payload.trajectoryDigest, /^[a-f0-9]{64}$/);
  assert.match(payload.evidenceDigest, /^[a-f0-9]{64}$/);
  const feedback = creditApi.toMemoryFeedback(credit, new Map([[0, ["memory-1"]]]));
  assert.equal(feedback[0].retrievedIds[0], "memory-1");
});

test("MetaHarness router selects cheapest model clearing measured quality", async () => {
  const { Router, calibrationReport, isNativeRouterAvailable, trainRouter } = await import("@metaharness/router");
  const router = new Router({ qualityBar: 0.8, candidates: [
    { id: "cheap", costPerMTok: 1, examples: [{ embedding: [1, 0], quality: 0.85 }] },
    { id: "expensive", costPerMTok: 10, examples: [{ embedding: [1, 0], quality: 0.99 }] }
  ] });
  assert.deepEqual(router.route([1, 0]), { id: "cheap", predictedQuality: 0.85, costPerMTok: 1, metBar: true });
  const report = calibrationReport([{ predicted: 0.8, realized: 1 }], 2);
  assert.equal(report.samples, 1);
  const trained = trainRouter([
    { embedding: [1, 0], scores: { cheap: 0.9, expensive: 1 } },
    { embedding: [0, 1], scores: { cheap: 0.8, expensive: 0.95 } }
  ], { cheap: 1, expensive: 10 }, { lambdas: [0.1], qualityBar: 0.8 });
  assert.equal(trained.router.route([1, 0]).id, "cheap");
  assert.equal(typeof await isNativeRouterAvailable(), "boolean");
});
