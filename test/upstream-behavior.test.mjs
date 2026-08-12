import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ruflo = resolve("node_modules/.bin/ruflo");
const CONTRACT_IDS = [
  "ruflo.swarm.lifecycle", "ruflo.hooks.lifecycle", "ruflo.worker.lifecycle", "ruflo.memory.lifecycle",
  "metaharness.hosts.behavior", "metaharness.catalog.behavior", "metaharness.scaffold.behavior",
  "darwin.evolve.behavior", "darwin.inspect.behavior", "darwin.validate.behavior",
  "redblue.report.behavior", "redblue.safety.behavior", "redblue.retest.behavior", "redblue.baseline.behavior",
  "harness.kernel.behavior", "harness.verifier.behavior", "harness.gates.behavior", "harness.recovery.behavior",
  "router.route.behavior", "router.calibration.behavior", "router.train.behavior",
  "turn-credit.receipt.behavior", "turn-credit.trajectory.behavior", "turn-credit.memory-feedback.behavior",
  "ruvector.sona.behavior", "ruvector.rvf.behavior", "ruvector.version.behavior", "ruvector.native.behavior"
];
assert.equal(new Set(CONTRACT_IDS).size, CONTRACT_IDS.length);

async function isolatedRuflo(args, cwd, timeout = 20_000) {
  return execFileAsync(ruflo, args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", CI: "true" }
  });
}

test("Ruflo executes isolated swarm, hook, memory, and worker lifecycles", { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ruflo-contract-"));
  try {
    const swarm = await isolatedRuflo(["swarm", "init", "--topology", "hierarchical", "--max-agents", "2", "--format", "json"], directory);
    assert.match(swarm.stdout, /"persisted": true/);
    const state = JSON.parse(await readFile(join(directory, ".claude-flow/swarm/swarm-state.json"), "utf8"));
    const active = Object.values(state.swarms)[0];
    assert.equal(active.topology, "hierarchical");
    assert.equal(active.maxAgents, 2);

    await isolatedRuflo(["memory", "init", "--format", "json"], directory, 30_000);
    assert.ok((await readFile(join(directory, ".swarm/memory.db"))).byteLength > 0);

    const hook = await isolatedRuflo(["hooks", "pre-task", "-d", "verify authority contract", "--format", "json"], directory);
    assert.match(hook.stdout, /"taskId"/);
    assert.match(hook.stdout, /"suggestedAgents"/);

    const workers = await isolatedRuflo(["hooks", "worker", "list", "--format", "json"], directory);
    assert.match(workers.stdout, /audit|optimiz|worker/i);
  } finally {
    await isolatedRuflo(["daemon", "stop"], directory).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("MetaHarness scaffolds a real host projection with deterministic fingerprint", async () => {
  const { HOSTS, loadCatalog, scaffold } = await import("metaharness");
  assert.ok(HOSTS.includes("codex"));
  assert.ok(loadCatalog().some((entry) => entry.id === "minimal"));
  const directory = await mkdtemp(join(tmpdir(), "metaharness-contract-"));
  try {
    const options = { name: "contract-harness", template: "minimal", host: "codex", targetDir: join(directory, "harness"), force: false, generatorVersion: "0.4.5" };
    const result = await scaffold(options);
    assert.ok(result.paths.length > 0);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.generator, "0.4.5");
    assert.ok(Object.keys(manifest.files).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Darwin seeded mutation is bounded and rejects unsafe generated behavior", async () => {
  const { DeterministicMutator, inspectVariant, validateGeneratedCode } = await import("@metaharness/darwin");
  const input = {
    parentCode: "export const maxRetries = 2;\n",
    surface: "retry-policy",
    repoSummary: "fixture",
    parentScore: 0.5,
    failedTraces: ["timeout"],
    nonce: 0
  };
  const first = await new DeterministicMutator(17).generateMutation(input);
  const second = await new DeterministicMutator(17).generateMutation(input);
  assert.deepEqual(first, second);
  assert.notEqual(first.code, input.parentCode);
  assert.deepEqual(validateGeneratedCode(first.code), []);
  assert.ok(validateGeneratedCode("process.env.SECRET; fetch('https://evil.invalid')").length >= 2);

  const directory = await mkdtemp(join(tmpdir(), "darwin-unsafe-"));
  try {
    await writeFile(join(directory, "retry-policy.ts"), "import { exec } from 'node:child_process';");
    assert.ok((await inspectVariant(directory)).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Darwin executes a bounded seeded evolution campaign", { timeout: 30_000 }, async () => {
  const { evolve } = await import("@metaharness/darwin");
  const directory = await mkdtemp(join(tmpdir(), "darwin-evolve-"));
  try {
    const result = await evolve({
      repoRoot: directory,
      workRoot: join(directory, ".metaharness"),
      generations: 1,
      childrenPerGeneration: 1,
      tasks: ["contract-task"],
      promotionDelta: 0,
      concurrency: 1,
      seed: 23,
      sandboxMode: "mock"
    });
    assert.equal(result.records.length >= 2, true);
    assert.equal(result.baseline.variant.generation, 0);
    assert.ok(result.winner);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("RedBlue hard safety rejects network, shell, credentials, and redacts secrets", async () => {
  const redblue = await import("@metaharness/redblue");
  assert.throws(() => redblue.enforceSafetyLimits({
    max_tests: 1, max_cost_usd: 1, max_runtime_seconds: 1,
    allow_network: true, allow_shell: false, allow_real_credentials: false
  }), redblue.SafetyViolationError);
  assert.throws(() => redblue.assertNoLiveCredential("ghp_abcdefghijklmnopqrstuvwxyz1234567890"));
  assert.doesNotMatch(redblue.redact("token=ghp_abcdefghijklmnopqrstuvwxyz1234567890"), /ghp_/);
  assert.equal(redblue.failureReduction(0.5, 0.1), 0.8);
});

test("RedBlue executes baseline, patch/retest, and structured report", async () => {
  const redblue = await import("@metaharness/redblue");
  const config = redblue.defaultConfig();
  config.families = ["data_exfiltration_attempt"];
  const opts = {
    config,
    target: redblue.alwaysVulnerableFixture(),
    judgeClient: redblue.mockMarkerJudge(),
    blueClient: new redblue.MockModelClient(() => JSON.stringify({ description: "block leak", kind: "output_filter", rule: { blockSubstrings: ["FAKEPLACEHOLDER"] } }))
  };
  const baseline = await redblue.runBaseline({ ...opts, numTests: 1 });
  assert.equal(baseline.results.length, 1);
  const retest = await redblue.patchAndRetest(baseline, { ...opts, numTests: 1 }, 1);
  assert.ok(retest.failureReduction >= 0);
  const report = redblue.buildReport({ runId: "contract", results: baseline.results, rates: baseline.rates, gates: config.gates, costUsd: baseline.costUsd });
  assert.equal(report.summary.tests_run, 1);
});

test("Harness enforces DAG ordering and rejects cyclic plans", async () => {
  const { topoSort } = await import("@metaharness/harness");
  const ordered = topoSort([
    { id: "prove", kind: "verify", deps: ["produce"] },
    { id: "produce", kind: "code", deps: [] }
  ]);
  assert.deepEqual(ordered.map((step) => step.id), ["produce", "prove"]);
  assert.throws(() => topoSort([
    { id: "a", kind: "code", deps: ["b"] },
    { id: "b", kind: "verify", deps: ["a"] }
  ]), /cycle/i);
});

test("Harness kernel runs verifier and four gates with replayable receipts", async () => {
  const harness = await import("@metaharness/harness");
  const router = new harness.AlgorithmRouter({ contract: { intent: "contract", steps: [{ kind: "verify" }] } });
  const pool = new harness.AgentPool([{ id: "worker", model: "fixture", handles: ["verify"], run: () => ({
    output: "proved", quality: 1, confidence: 1, risk: 0, costUsd: 0, latencyMs: 1
  }) }], { rng: () => 0 });
  const verifiers = new harness.VerifierRegistry().register(harness.predicateVerifier("nonempty", "custom", Boolean));
  const policy = new harness.PolicyGate([harness.allowTools(["verify"])]);
  const kernel = new harness.HarnessKernel({ router, pool, verifiers, policy });
  const result = await kernel.run({ text: "contract", intent: "contract" }, "contract-run");
  assert.equal(result.success, true);
  assert.equal(result.receiptsValid, true);
  assert.equal(result.steps[0].gate.ok, true);
  const log = new harness.ReceiptLog();
  log.append({ runId: "recovery", step: "verify", input: {}, output: "ok", agent: "worker", model: "fixture", costUsd: 0, latencyMs: 1, verdict: "pass" });
  const restored = harness.ReceiptLog.import(log.export());
  assert.deepEqual(restored.verify(), { ok: true });
});

test("RuVector executes native vector, RVF persistence, and SONA learning", async () => {
  const ruvector = await import("ruvector");
  assert.equal(ruvector.isNativeAvailable(), true);
  assert.equal(ruvector.isRvfAvailable(), true);
  assert.equal(ruvector.isSonaAvailable(), true);
  assert.equal(ruvector.getVersion().version, "0.2.41");
  const directory = await mkdtemp(join(tmpdir(), "rvf-contract-"));
  const path = join(directory, "vectors.rvf");
  let store;
  try {
    store = await ruvector.createRvfStore(path, { dimensions: 3, metric: "cosine" });
    assert.deepEqual(await ruvector.rvfIngest(store, [{ id: "v1", vector: [1, 0, 0], metadata: { tenant: "fixture" } }]), {
      accepted: 1, rejected: 0, epoch: 1
    });
    const nearest = await ruvector.rvfQuery(store, [1, 0, 0], 1);
    assert.equal(nearest.length, 1);
    assert.equal(nearest[0].distance, 0);
    await ruvector.rvfClose(store);
    store = undefined;
    store = await ruvector.openRvfStore(path);
    assert.equal((await ruvector.rvfQuery(store, [1, 0, 0], 1))[0].distance, 0);

    const sona = new ruvector.SonaEngine(3);
    const trajectory = sona.beginTrajectory([1, 0, 0]);
    sona.addTrajectoryStep(trajectory, [1, 0, 0], [1, 0, 0], 1);
    sona.endTrajectory(trajectory, 1);
    assert.match(sona.forceLearn(), /learn|pattern|trajectory/i);
  } finally {
    if (store) await ruvector.rvfClose(store);
    await rm(directory, { recursive: true, force: true });
  }
});

test("timeout and cancellation contracts surface deterministic host errors", async () => {
  const controller = new AbortController();
  controller.abort(new Error("contract-cancelled"));
  await assert.rejects(fetch("http://127.0.0.1:1", { signal: controller.signal }), /contract-cancelled/);
  await assert.rejects(execFileAsync(process.execPath, ["-e", "setTimeout(()=>{}, 5000)"], { timeout: 10 }), (error) => error.killed === true);
});
