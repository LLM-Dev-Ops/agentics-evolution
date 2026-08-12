import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validator = new URL("../scripts/check-ddd-boundaries.mjs", import.meta.url).pathname;
const names = ["observation", "dream", "evolution", "evaluation", "governance", "operations", "brain-knowledge", "repository-integration", "artifact-lineage", "evaluation-corpus"];
const configuration = `schemaVersion: agentics.context-boundaries/v1
root: src/contexts
packageName: agentics-evolution
contexts: [${names.join(", ")}]
requiredLayers: [domain, application, infrastructure]
publicEntrypoint: index.ts
allowedCrossContextTargets: [published-language, application]
forbiddenPublicSegments: [infrastructure]
upstreamPackages: [ruflo, "@metaharness/darwin", "@metaharness/flywheel", ruvector]
`;

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "agentics-ddd-"));
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(join(root, "config/context-boundaries.yaml"), configuration);
  for (const name of names) {
    for (const layer of ["domain", "application", "infrastructure"]) {
      const path = `src/contexts/${name}/${layer}/index.ts`;
      await mkdir(join(root, `src/contexts/${name}/${layer}`), { recursive: true });
      await writeFile(join(root, path), overrides[path] ?? "export {};\n");
    }
    for (const file of ["index.ts", "published-language.ts"]) {
      const path = `src/contexts/${name}/${file}`;
      await writeFile(join(root, path), overrides[path] ?? "export {};\n");
    }
  }
  for (const [path, source] of Object.entries(overrides)) {
    if (path.startsWith("!")) continue;
    await mkdir(join(root, path.split("/").slice(0, -1).join("/")), { recursive: true });
    await writeFile(join(root, path), source);
  }
  return root;
}
function validate(root) { return spawnSync(process.execPath, [validator, root], { encoding: "utf8" }); }
function expectFailure(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

test("accepts the exact ten-context topology and a permitted published-language dependency", async () => {
  const root = await fixture({
    "src/contexts/dream/application/index.ts": "import type { ObservationPublished } from '../../observation/published-language.js';\nexport type Input = ObservationPublished;\n",
    "src/contexts/observation/published-language.ts": "export interface ObservationPublished { readonly id: string }\n"
  });
  assert.equal(validate(root).status, 0);
});

test("rejects a missing required layer", async () => {
  const sparse = await mkdtemp(join(tmpdir(), "agentics-ddd-sparse-"));
  await mkdir(join(sparse, "config"), { recursive: true });
  await mkdir(join(sparse, "src/contexts"), { recursive: true });
  await writeFile(join(sparse, "config/context-boundaries.yaml"), configuration);
  expectFailure(validate(sparse), /required domain\/index.ts is missing/);
});

for (const [name, path, source, pattern] of [
  ["cross-context domain import", "src/contexts/dream/domain/index.ts", "import '../../observation/domain/index.js';\n", /domain cannot import another context/],
  ["cross-context infrastructure import", "src/contexts/dream/application/index.ts", "import '../../observation/infrastructure/index.js';\n", /cross-context dependency may target only/],
  ["same-context domain to application", "src/contexts/dream/domain/index.ts", "import '../application/index.js';\n", /domain cannot depend on application/],
  ["same-context application to infrastructure", "src/contexts/dream/application/index.ts", "import '../infrastructure/index.js';\n", /application cannot depend on infrastructure/],
  ["public infrastructure export", "src/contexts/dream/index.ts", "export * from './infrastructure/index.js';\n", /public context entrypoint exposes infrastructure/],
  ["cross-context re-export", "src/contexts/dream/index.ts", "export * from '../observation/published-language.js';\n", /context public surface cannot re-export another context/],
  ["direct upstream import", "src/contexts/evolution/application/index.ts", "import type { Darwin } from '@metaharness/darwin';\n", /raw upstream type\/import/],
  ["dynamic upstream import", "src/contexts/evolution/infrastructure/index.ts", "const api = import('@metaharness/darwin');\n", /raw upstream type\/import/],
  ["import-type upstream leak", "src/contexts/evolution/application/index.ts", "export type Raw = import('@metaharness/darwin').Config;\n", /raw upstream type\/import/]
  ,["CommonJS upstream require", "src/contexts/evolution/infrastructure/index.ts", "const api = require('@metaharness/darwin');\n", /raw upstream type\/import/]
  ,["non-kernel module escape", "src/contexts/dream/domain/index.ts", "import '../../../trust/index.js';\n", /cannot import non-kernel module/]
  ,["package self-import bypass", "src/contexts/dream/application/index.ts", "import 'agentics-evolution/contexts/observation';\n", /self-import bypasses/]
]) {
  test(`rejects ${name}`, async () => expectFailure(validate(await fixture({ [path]: source })), pattern));
}

test("rejects non-past-tense domain event and missing aggregate ID", async () => {
  const root = await fixture({
    "src/contexts/dream/domain/index.ts": "interface DomainEvent {}\nexport interface ProposeHypothesis extends DomainEvent { readonly tenantId: string }\n"
  });
  const result = validate(root);
  expectFailure(result, /must use a past-tense name/);
  assert.match(result.stderr, /must carry aggregateId/);
});

test("rejects mutable aggregate ID and accepts immutable past-tense event", async () => {
  const rejected = validate(await fixture({
    "src/contexts/dream/domain/index.ts": "interface DomainEvent {}\nexport interface HypothesisProposed extends DomainEvent { aggregateId: string }\n"
  }));
  expectFailure(rejected, /aggregateId must be readonly/);
  const accepted = validate(await fixture({
    "src/contexts/dream/domain/index.ts": "interface DomainEvent {}\nexport interface HypothesisProposed extends DomainEvent { readonly aggregateId: string }\n"
  }));
  assert.equal(accepted.status, 0, accepted.stderr);
});
