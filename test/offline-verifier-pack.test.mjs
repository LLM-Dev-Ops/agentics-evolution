import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

test("npm-packed offline verifier installs from cache without repository build paths", { timeout: 120_000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), "agentics-verifier-pack-")); t.after(() => rm(temp, { recursive: true, force: true }));
  const source = resolve("packages/offline-verifier");
  const packed = JSON.parse((await exec("npm", ["pack", source, "--json", "--pack-destination", temp])).stdout);
  const tarball = join(temp, packed[0].filename); assert.ok(packed[0].files.some(({ path }) => path === "native-rvf-plugin.mjs"));
  await writeFile(join(temp, "package.json"), JSON.stringify({ private: true }));
  await exec("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: temp });
  const moduleRoot = join(temp, "node_modules", "@agentics-evolution", "offline-verifier");
  assert.doesNotMatch(await readFile(join(moduleRoot, "native-rvf-plugin.mjs"), "utf8"), /\.\.\/\.\.\/dist/);
  const installed = JSON.parse(await readFile(join(moduleRoot, "package.json"), "utf8"));
  assert.equal(installed.dependencies.ruvector, "0.2.41"); assert.equal(installed.dependencies["@ruvector/rvf"], "0.2.3");
  const imported = await import(join(moduleRoot, "index.mjs")); assert.equal(typeof imported.verifyBundle, "function");
});
