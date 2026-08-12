import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("clean install policy disables scripts and selects platform optionals explicitly", async () => {
  const npmrc = await readFile(".npmrc", "utf8");
  assert.match(npmrc, /^engine-strict=true$/m);
  assert.match(npmrc, /^ignore-scripts=true$/m);
  assert.match(npmrc, /^omit=optional$/m);
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.engines.node, ">=20 <21");
  assert.equal(manifest.packageManager, "npm@10.9.4");
});

test("every top-level dependency is integrity bound", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.version, version, `${name} version`);
    assert.match(entry.integrity, /^sha512-/, `${name} integrity`);
  }
});

test("platform artifact catalog exactly binds optional production packages", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("config/platform-artifacts-lock.json", "utf8"));
  const { parse } = await import("yaml");
  const catalog = parse(await readFile("config/upstream-authorities.yaml", "utf8"));
  const artifacts = new Map(catalog.platformArtifacts.map((item) => [item.package, item]));
  const platformDependencies = manifest.agentics.platformDependencies;
  assert.deepEqual([...artifacts.keys()].sort(), Object.keys(platformDependencies).sort());
  for (const [name, version] of Object.entries(platformDependencies)) {
    assert.equal(artifacts.get(name).version, version);
    assert.equal(artifacts.get(name).integrity, lock.packages[name].integrity);
  }
});
