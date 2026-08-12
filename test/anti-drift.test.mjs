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
