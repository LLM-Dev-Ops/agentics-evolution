import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("all direct dependencies use exact versions", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  for (const version of Object.values({ ...manifest.dependencies, ...manifest.devDependencies }))
    assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("source files remain below 500 lines", async () => {
  const source = await readFile("src/upstream/authority.ts", "utf8");
  assert.ok(source.split(/\r?\n/).length <= 500);
});
