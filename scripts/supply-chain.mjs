import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { sha256 } from "./lib/evidence.mjs";
import { dependencyPolicyFailures, maintainerPolicyFailures, vulnerabilityPolicyFailures } from "./lib/supply-policy.mjs";

const manifestText = await readFile("package.json", "utf8");
const lockText = await readFile("package-lock.json", "utf8");
const npmrc = await readFile(".npmrc", "utf8");
const catalogText = await readFile("config/upstream-authorities.yaml", "utf8");
const policyText = await readFile("config/supply-chain-policy.json", "utf8");
const platformLockText = await readFile("config/platform-artifacts-lock.json", "utf8");
const manifest = JSON.parse(manifestText);
const lock = JSON.parse(lockText);
const catalog = parse(catalogText);
const policy = JSON.parse(policyText);
const platformLock = JSON.parse(platformLockText);
const failures = [];
const platformDependencies = manifest.agentics?.platformDependencies ?? {};
const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
const forbiddenLicense = /(?:^|\s|\()(?:AGPL|SSPL|BUSL)(?:-|\s|\)|$)/i;

if (manifest.engines?.node !== ">=20 <21") failures.push("Node runtime must be constrained to major 20");
if (manifest.packageManager !== "npm@10.9.4") failures.push("npm must be pinned to 10.9.4");
if (!/^ignore-scripts=true$/m.test(npmrc)) failures.push("dependency lifecycle scripts must be disabled");
if (!/^engine-strict=true$/m.test(npmrc)) failures.push("engine-strict must be enabled");
if (!/^omit=optional$/m.test(npmrc)) failures.push("optional dependencies must be isolated from production installs");
if (lock.lockfileVersion !== 3) failures.push("npm lockfileVersion 3 is required");

const inventory = [];
const licenses = [];
const native = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path || !path.startsWith("node_modules/")) continue;
  const name = path.slice("node_modules/".length);
  const item = {
    name,
    version: entry.version ?? "unknown",
    integrity: entry.integrity ?? null,
    optional: entry.optional === true,
    dev: entry.dev === true
  };
  inventory.push(item);
  const license = entry.license ?? "UNKNOWN";
  licenses.push({ name, version: item.version, license });
  if (forbiddenLicense.test(license)) failures.push(`${name}: forbidden license ${license}`);
  if (entry.hasInstallScript || entry.cpu || entry.os || entry.libc || /(?:binding|native|wasm|onnx|sharp|sqlite|ruvector)/i.test(name)) {
    native.push({ ...item, hasInstallScript: entry.hasInstallScript === true, cpu: entry.cpu ?? [], os: entry.os ?? [], libc: entry.libc ?? [] });
  }
}
inventory.sort((a, b) => a.name.localeCompare(b.name));
licenses.sort((a, b) => a.name.localeCompare(b.name));
native.sort((a, b) => a.name.localeCompare(b.name));

for (const [name, version] of Object.entries(dependencies)) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push(`${name}: version is not an exact semver pin`);
  const locked = lock.packages?.[`node_modules/${name}`];
  if (!locked?.integrity) failures.push(`${name}: missing lockfile integrity`);
  if (locked?.version !== version) failures.push(`${name}: manifest/lock version mismatch`);
  failures.push(...dependencyPolicyFailures(name, locked, policy));
}
for (const authority of catalog.authorities) {
  if (manifest.dependencies?.[authority.package] !== String(authority.version))
    failures.push(`${authority.package}: authority catalog version mismatch`);
  try {
    const output = execFileSync("npm", ["view", `${authority.package}@${authority.version}`, "maintainers", "--json"], { encoding: "utf8" });
    const maintainers = JSON.parse(output);
    failures.push(...maintainerPolicyFailures(authority.package, Array.isArray(maintainers) ? maintainers : [maintainers], policy));
  } catch (error) {
    failures.push(`${authority.package}: unable to verify registry maintainers: ${error.message}`);
  }
}
const optional = platformDependencies;
const catalogArtifacts = new Map((catalog.platformArtifacts ?? []).map((artifact) => [artifact.package, artifact]));
if (catalogArtifacts.size !== Object.keys(optional).length)
  failures.push("platform artifact catalog must exactly cover agentics.platformDependencies");
for (const [name, version] of Object.entries(optional)) {
  const artifact = catalogArtifacts.get(name);
  const locked = platformLock.packages?.[name];
  if (!artifact) failures.push(`${name}: optional production artifact is not cataloged`);
  else {
    if (artifact.version !== version) failures.push(`${name}: platform catalog/manifest version mismatch`);
    if (artifact.integrity !== locked?.integrity) failures.push(`${name}: platform catalog/lock integrity mismatch`);
  }
}
for (const name of catalogArtifacts.keys())
  if (!(name in optional)) failures.push(`${name}: cataloged platform artifact is absent from agentics.platformDependencies`);
for (const name of Object.keys(platformLock.packages ?? {}))
  if (!(name in optional)) failures.push(`${name}: platform lock artifact is absent from agentics.platformDependencies`);

let audit;
try {
  audit = JSON.parse(execFileSync("npm", ["audit", "--omit=optional", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch (error) {
  const output = error.stdout?.toString();
  try { audit = JSON.parse(output); } catch { failures.push(`npm audit failed: ${error.message}`); }
}
failures.push(...vulnerabilityPolicyFailures("production dependency graph", audit));

const architecture = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
if (process.platform !== "linux" || !architecture) failures.push(`unsupported production platform ${process.platform}-${process.arch}`);
const selectedArtifacts = (catalog.platformArtifacts ?? []).filter(({ platform }) => platform === "any" || platform === `linux-${architecture}-gnu`);
let platformAudit = { error: "platform audit unavailable" };
let platformInventory = [];
if (architecture) {
  const directory = await mkdtemp(join(tmpdir(), "agentics-platform-audit-"));
  try {
    const selectedManifest = {
      name: "agentics-selected-platform-audit",
      version: "0.0.0",
      private: true,
      dependencies: Object.fromEntries(selectedArtifacts.map(({ package: name, version }) => [name, version]))
    };
    await writeFile(join(directory, "package.json"), `${JSON.stringify(selectedManifest, null, 2)}\n`);
    execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--omit=optional"], { cwd: directory, stdio: "pipe" });
    const selectedLock = JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8"));
    platformInventory = Object.entries(selectedLock.packages ?? {})
      .filter(([path]) => path.startsWith("node_modules/"))
      .map(([path, entry]) => ({
        name: path.slice("node_modules/".length), version: entry.version, integrity: entry.integrity,
        license: entry.license ?? "UNKNOWN", native: Boolean(entry.cpu || entry.os || entry.libc || entry.hasInstallScript)
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const artifact of selectedArtifacts) {
      const resolved = selectedLock.packages?.[`node_modules/${artifact.package}`];
      if (resolved?.version !== artifact.version || resolved?.integrity !== artifact.integrity)
        failures.push(`${artifact.package}: selected-platform resolved graph drifted from catalog integrity`);
    }
    try {
      platformAudit = JSON.parse(execFileSync("npm", ["audit", "--omit=optional", "--json"], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    } catch (error) {
      platformAudit = JSON.parse(error.stdout?.toString() ?? "{}");
    }
    failures.push(...vulnerabilityPolicyFailures("selected platform graph", platformAudit));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await mkdir("reports", { recursive: true });
const common = { generatedFrom: { packageSha256: sha256(manifestText), lockSha256: sha256(lockText) } };
await Promise.all([
  writeFile("reports/dependency-inventory.json", `${JSON.stringify({ schemaVersion: "agentics.dependencies/v1", ...common, packages: inventory }, null, 2)}\n`),
  writeFile("reports/license-report.json", `${JSON.stringify({ schemaVersion: "agentics.licenses/v1", ...common, packages: licenses }, null, 2)}\n`),
  writeFile("reports/native-inventory.json", `${JSON.stringify({ schemaVersion: "agentics.native-inventory/v1", ...common, packages: native }, null, 2)}\n`),
  writeFile("reports/audit-production.json", `${JSON.stringify(audit ?? { error: "audit unavailable" }, null, 2)}\n`),
  writeFile("reports/audit-platform.json", `${JSON.stringify({ platform: `${process.platform}-${process.arch}`, selectedArtifacts, inventory: platformInventory, audit: platformAudit }, null, 2)}\n`)
]);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
