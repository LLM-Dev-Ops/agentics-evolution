import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "yaml";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const catalogText = await readFile("config/upstream-authorities.yaml", "utf8");
const catalog = parse(catalogText);
const failures = [];
const floating = /^(?:[~^*]|latest$|next$|git\+|https?:|file:)/;
for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
  if (floating.test(version)) failures.push(`${name}: floating or remote version ${version}`);
  const resolved = lock.packages?.[`node_modules/${name}`];
  if (!resolved?.integrity) failures.push(`${name}: lockfile integrity missing`);
}
for (const authority of catalog.authorities) {
  if (manifest.dependencies[authority.package] !== String(authority.version))
    failures.push(`${authority.package}: catalog/package mismatch`);
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
  authorities: catalog.authorities.map(({ name, package: packageName, version, capabilities }) => ({ name, package: packageName, version: String(version), capabilities }))
};
await writeFile("reports/conformance.json", `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
