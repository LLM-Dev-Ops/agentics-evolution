import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ruflo = resolve("node_modules/.bin/ruflo");

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
  const { scaffold } = await import("metaharness");
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

test("RuVector executes native vector, RVF persistence, and SONA learning", async () => {
  const ruvector = await import("ruvector");
  assert.equal(ruvector.isNativeAvailable(), true);
  assert.equal(ruvector.isRvfAvailable(), true);
  assert.equal(ruvector.isSonaAvailable(), true);
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
