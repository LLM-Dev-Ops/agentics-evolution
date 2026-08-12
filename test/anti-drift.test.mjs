import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const checker = new URL("../scripts/check-source.mjs", import.meta.url).pathname;
const basePolicy = `schemaVersion: agentics.source-policy/v1
maxLines: 500
publicEntrypoints: [src/index.ts]
layers:
  domain: src/domain
  application: src/application
  infrastructure: src/infrastructure
generatedExemptions: []
allowedUpstreamAdapters:
  "@metaharness/darwin": src/infrastructure/upstream-darwin
forbiddenAlgorithmSymbols: [evolve, inspectVariant]
`;
const catalog = `schemaVersion: agentics.upstream-authorities/v1
authorities:
  - package: "@metaharness/darwin"
    adapter: infrastructure/upstream-darwin
hosts: []
`;

async function fixture(source, path = "src/domain/example.ts", policy = basePolicy) {
  const root = await mkdtemp(join(tmpdir(), "agentics-boundary-"));
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(root, path.split("/").slice(0, -1).join("/")), { recursive: true });
  await writeFile(join(root, "config/source-policy.yaml"), policy);
  await writeFile(join(root, "config/upstream-authorities.yaml"), catalog);
  await writeFile(join(root, path), source);
  return root;
}
function check(root) {
  return spawnSync(process.execPath, [checker, root], { encoding: "utf8" });
}

test("allows an upstream package only in its recorded adapter", async () => {
  const root = await fixture("export { evolve } from '@metaharness/darwin';\n", "src/infrastructure/upstream-darwin/index.ts");
  assert.equal(check(root).status, 0);
});

for (const [name, source] of [
  ["static import", "import { evolve } from '@metaharness/darwin';\n"],
  ["re-export", "export { evolve } from '@metaharness/darwin';\n"],
  ["dynamic import", "const api = import('@metaharness/darwin');\n"],
  ["CommonJS require", "const api = require('@metaharness/darwin');\n"]
]) {
  test(`rejects direct domain ${name}`, async () => {
    const result = check(await fixture(source));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be owned by src\/infrastructure\/upstream-darwin/);
  });
}

test("rejects duplicated upstream algorithm declarations without false positives on calls", async () => {
  const rejected = check(await fixture("export function evolve() { return []; }\n"));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /duplicates upstream-owned algorithm symbol 'evolve'/);
  const allowed = check(await fixture("export function requestEvolution(port) { return port.evolve(); }\n"));
  assert.equal(allowed.status, 0);
});

const algorithmClones = [
  ["darwin-search", "7725e4be84dffcd1dd4529a2314cde9b542fa897bdc39a0be2fdc787fb2c4dcc", `function explore(origin, epochs) { let candidates = [origin]; for (let generation = 0; generation < epochs; generation++) { candidates = candidates.flatMap(item => [item, alter(item)]); candidates.sort((first,second) => rank(second)-rank(first)); candidates = candidates.slice(0, 9); } return candidates; }`],
  ["darwin-safety", "c80f42e438a7523d19981cef2c0affcb7f6ed17fc34cc7f5f097a872171364ad", `function approve(subject, checks) { for (const check of checks) { if (!check.inspect(subject)) { return false; } } return true; }`],
  ["flywheel-gate", "57f5abd595e6953cc57b4c655036ead51c2df73f133a0894348955e2ce19123c", `function qualify(result, bounds) { if (result.safe < bounds.safe) return false; if (result.good < bounds.good) return false; return result.price <= bounds.price; }`],
  ["flywheel-sequential", "02c9a16cb0c705ea0a709e14aa30a096ac8b001f308620c6e89b3101815715f2", `function consume(budget, trials) { let balance = budget; for (const trial of trials) { balance -= trial.charge; if (balance < 0) throw new Error('spent'); } return balance; }`],
  ["flywheel-canonicalization", "bf233b66e7dfeba212614ea8bb9b612a72431f3760a6873a3a2bf55c462d3af7", `function stable(record) { const names = Object.keys(record).sort(); return JSON.stringify(names.map(name => [name, record[name]])); }`],
  ["flywheel-signing", "455f9b8b0817a887df4db5a16c1347b6037eb528e1c808ce34648974f615d7ed", `function seal(message, key) { const checksum = hash(message); const proof = key.sign(checksum); return { checksum, proof }; }`],
  ["flywheel-replay", "910e7a665b94d1e6d0b7062eadd6f0508d35a023c88e2665a1865efaa0c0c251", `function rebuild(entries) { let aggregate = initial(); for (const entry of entries) { verify(entry); aggregate = apply(aggregate, entry); } return aggregate; }`],
  ["router-scoring", "b12ac0f6da47a7f8d83e6f3ef88a97406348fd4405af16f562218300dfaf0efd", `function choose(models, floor) { const viable = models.filter(model => model.value >= floor); viable.sort((left,right) => left.price-right.price); return viable[0]; }`],
  ["ruvector-similarity", "2f1d9c6eda3a9e62601f0d7c8dd8dd0bafec79e31e2d8a347d006d0a15d13ecc", `function compare(x, y) { let product = 0; let xnorm = 0; let ynorm = 0; for (let offset=0; offset<x.length; offset++) { product += x[offset]*y[offset]; xnorm += x[offset]*x[offset]; ynorm += y[offset]*y[offset]; } return product / (Math.sqrt(xnorm)*Math.sqrt(ynorm)); }`],
  ["ruvector-sona", "6153f2332c1c1545d772385b6f02827c49d5bcff30cea6e70f4c4e3576815bd5", `function adjust(parameters, delta, step) { return parameters.map((parameter, position) => parameter - step * delta[position]); }`]
];

for (const [family, digest, clone] of algorithmClones) {
  test(`rejects renamed structural clone of ${family}`, async () => {
    const policy = `${basePolicy}\nalgorithmFingerprints:\n  ${family}: [${digest}]\n`;
    const result = check(await fixture(`${clone}\n`, "src/domain/renamed.ts", policy));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`structurally duplicates upstream-owned ${family} algorithm`));
  });
}

for (const [name, benign] of [
  ["ordinary validation", `function validate(items) { return items.every(item => item != null); }`],
  ["ordinary sorting", `function alphabetize(items) { return [...items].sort((a,b) => a.name.localeCompare(b.name)); }`],
  ["ordinary accounting", `function total(lines) { return lines.reduce((sum,line) => sum + line.amount, 0); }`],
  ["port delegation", `function delegate(port, request) { return port.evolve(request); }`]
]) {
  test(`permits benign ${name}`, async () => {
    const entries = algorithmClones.map(([family, digest]) => `  ${family}: [${digest}]`).join("\n");
    const result = check(await fixture(`${benign}\n`, "src/domain/benign.ts", `${basePolicy}\nalgorithmFingerprints:\n${entries}\n`));
    assert.equal(result.status, 0, result.stderr);
  });
}

test("rejects files over the repository line limit", async () => {
  const result = check(await fixture(`${"x\n".repeat(500)}x`, "notes.txt"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /501 lines exceeds 500/);
});

test("requires every generated exemption to name an existing file and reason", async () => {
  const missingReason = `${basePolicy.replace("generatedExemptions: []", "generatedExemptions:\n  - { path: generated.ts, reason: '' }")}`;
  const result = check(await fixture("export {};\n", "src/example.ts", missingReason));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated exemption requires a reason/);
  assert.match(result.stderr, /generated exemption does not match a file/);
});

test("rejects authority catalog and policy ownership drift", async () => {
  const drifted = basePolicy.replace("src/infrastructure/upstream-darwin", "src/infrastructure/not-darwin");
  const result = check(await fixture("export {};\n", "src/example.ts", drifted));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /catalog adapter .* disagrees with source policy/);
});

test("rejects package exports that expose infrastructure", async () => {
  const root = await fixture("export {};\n", "src/example.ts");
  await writeFile(join(root, "package.json"), JSON.stringify({
    type: "module",
    exports: { "./database": "./dist/infrastructure/database.js" }
  }));
  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exposes infrastructure target/);
});

test("rejects missing and malformed required algorithm-family evidence", async () => {
  const policy = `${basePolicy}\nrequiredAlgorithmFamilies: [darwin-search, flywheel-gate]\nalgorithmFingerprints:\n  darwin-search: [not-a-digest]\n`;
  const result = check(await fixture("export {};\n", "src/example.ts", policy));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /darwin-search has invalid SHA-256 fingerprint/);
  assert.match(result.stderr, /required algorithm family 'flywheel-gate' has no structural fingerprints/);
});

test("rejects mutable GitHub Action tags", async () => {
  const root = await fixture("export {};\n", "src/example.ts");
  const workflow = join(root, ".github", "workflows");
  await mkdir(workflow, { recursive: true });
  await writeFile(join(workflow, "verify.yml"), "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n");
  const result = check(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /immutable 40-character commit SHAs/);
});

for (const [name, sourcePath, source, message] of [
  ["domain-to-application", "src/domain/model.ts", "export { port } from '../application/port.js';\n", /domain cannot import application or infrastructure/],
  ["domain-to-infrastructure", "src/domain/model.ts", "import '../infrastructure/db.js';\n", /domain cannot import application or infrastructure/],
  ["application-to-infrastructure", "src/application/use-case.ts", "export * from '../infrastructure/db.js';\n", /application cannot import infrastructure/],
  ["public infrastructure export", "src/index.ts", "export * from './infrastructure/db.js';\n", /public entrypoint cannot export infrastructure/]
]) {
  test(`rejects ${name} dependency`, async () => {
    const result = check(await fixture(source, sourcePath));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}
