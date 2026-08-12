import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadAuthorityCatalog, lockEntry } from "./authority-catalog.mjs";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const catalogText = await readFile("config/upstream-authorities.yaml", "utf8");
const loaded = await loadAuthorityCatalog();
const catalog = loaded.catalog;
const failures = [...loaded.failures];
const floating = /^(?:[~^*]|latest$|next$|git\+|https?:|file:)/;
for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
  if (floating.test(version)) failures.push(`${name}: floating or remote version ${version}`);
  const resolved = lock.packages?.[`node_modules/${name}`];
  if (!resolved?.integrity) failures.push(`${name}: lockfile integrity missing`);
}
for (const authority of [...catalog.authorities, ...catalog.hosts]) {
  if (manifest.dependencies[authority.package] !== authority.version)
    failures.push(`${authority.package}: catalog/package mismatch`);
  const installed = lockEntry(lock, authority.package);
  if (installed?.version !== authority.version) failures.push(`${authority.package}: catalog/lock version mismatch`);
  if (installed?.integrity !== authority.integrity) failures.push(`${authority.package}: catalog/lock integrity mismatch`);
}
const report = {
  schemaVersion: "agentics.conformance/v1",
  passed: failures.length === 0,
  failures,
  sourceDigests: {
    package: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    lock: createHash("sha256").update(JSON.stringify(lock)).digest("hex"),
    authorities: createHash("sha256").update(catalogText).digest("hex")
  },
  authorities: catalog.authorities.map(({ name, package: packageName, version, integrity, requiredExports, requiredCapabilities, owner }) => ({
    name, package: packageName, version, integrity, requiredExports, requiredCapabilities, owner
  })),
  hosts: catalog.hosts.map(({ name, package: packageName, version, integrity, requiredExports, owner }) => ({
    name, package: packageName, version, integrity, requiredExports, owner
  })),
  sourceAuthorities: catalog.sourceAuthorities.map(({ name, repository, commit, sourceTree, path, build, requiredCapabilities, owner }) => ({
    name, repository, commit, sourceTree, path, build, requiredCapabilities, owner
  }))
};
await writeFile("reports/conformance.json", `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
