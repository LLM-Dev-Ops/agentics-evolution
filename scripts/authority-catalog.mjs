import { access, readFile } from "node:fs/promises";
import { parse } from "yaml";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

function nonEmptyStrings(value, path, failures) {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${path}: expected a non-empty string array`);
    return;
  }
  if (value.some((item) => typeof item !== "string" || item.length === 0))
    failures.push(`${path}: contains a non-string or empty value`);
  if (new Set(value).size !== value.length) failures.push(`${path}: contains duplicates`);
}

function validatePackage(entry, path, { authority = false } = {}) {
  const failures = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [`${path}: expected an object`];
  if (typeof entry.name !== "string" || !NAME.test(entry.name)) failures.push(`${path}.name: invalid`);
  if (typeof entry.package !== "string" || entry.package.length === 0) failures.push(`${path}.package: required`);
  if (typeof entry.version !== "string" || !EXACT_VERSION.test(entry.version)) failures.push(`${path}.version: must be exact`);
  if (typeof entry.integrity !== "string" || !INTEGRITY.test(entry.integrity)) failures.push(`${path}.integrity: invalid sha512`);
  if (typeof entry.owner !== "string" || entry.owner.length === 0) failures.push(`${path}.owner: required`);
  nonEmptyStrings(entry.contractTests, `${path}.contractTests`, failures);
  if (!Array.isArray(entry.requiredExports)) failures.push(`${path}.requiredExports: expected an array`);
  else if (new Set(entry.requiredExports).size !== entry.requiredExports.length) failures.push(`${path}.requiredExports: contains duplicates`);
  if (authority) {
    if (!['cli', 'module'].includes(entry.probe)) failures.push(`${path}.probe: expected cli or module`);
    if (typeof entry.adapter !== "string" || !entry.adapter.startsWith("infrastructure/upstream-")) failures.push(`${path}.adapter: invalid`);
    nonEmptyStrings(entry.requiredCapabilities, `${path}.requiredCapabilities`, failures);
    const mapped = entry.capabilityTests;
    if (!mapped || typeof mapped !== "object" || Array.isArray(mapped)) failures.push(`${path}.capabilityTests: expected a map`);
    else {
      const expected = [...entry.requiredCapabilities].sort();
      const actual = Object.keys(mapped).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${path}.capabilityTests: keys must exactly match requiredCapabilities`);
      for (const [capability, testId] of Object.entries(mapped))
        if (typeof testId !== "string" || !/^[a-z0-9.-]+$/.test(testId)) failures.push(`${path}.capabilityTests.${capability}: invalid test id`);
    }
    nonEmptyStrings(entry.upstreamAdrs, `${path}.upstreamAdrs`, failures);
    if (!Array.isArray(entry.deviations)) failures.push(`${path}.deviations: expected an array`);
    for (const [index, deviation] of (entry.deviations ?? []).entries()) {
      for (const field of ["owner", "expiresAt", "threatAnalysis", "adr"])
        if (typeof deviation?.[field] !== "string" || deviation[field].length === 0)
          failures.push(`${path}.deviations[${index}].${field}: required`);
      if (typeof deviation?.expiresAt === "string" && Number.isNaN(Date.parse(deviation.expiresAt)))
        failures.push(`${path}.deviations[${index}].expiresAt: invalid date`);
    }
  }
  return failures;
}

export async function loadAuthorityCatalog(path = "config/upstream-authorities.yaml") {
  const text = await readFile(path, "utf8");
  const catalog = parse(text);
  const failures = [];
  if (catalog?.schemaVersion !== "agentics.upstream-authorities/v1") failures.push("schemaVersion: unsupported");
  if (typeof catalog?.node !== "string" || !EXACT_VERSION.test(catalog.node)) failures.push("node: must be exact");
  if (catalog?.policy?.unknownExports !== "reject") failures.push("policy.unknownExports: must reject");
  if (catalog?.policy?.missingCapabilities !== "reject") failures.push("policy.missingCapabilities: must reject");
  if (catalog?.policy?.deviationsRequireExpiry !== true) failures.push("policy.deviationsRequireExpiry: must be true");
  if (!Array.isArray(catalog?.authorities) || catalog.authorities.length === 0) failures.push("authorities: required");
  if (!Array.isArray(catalog?.hosts) || catalog.hosts.length === 0) failures.push("hosts: required");
  if (!Array.isArray(catalog?.sourceAuthorities) || catalog.sourceAuthorities.length === 0) failures.push("sourceAuthorities: required");
  if (!Array.isArray(catalog?.platformArtifacts) || catalog.platformArtifacts.length === 0) failures.push("platformArtifacts: required");
  for (const [index, authority] of (catalog?.authorities ?? []).entries())
    failures.push(...validatePackage(authority, `authorities[${index}]`, { authority: true }));
  for (const [index, host] of (catalog?.hosts ?? []).entries())
    failures.push(...validatePackage(host, `hosts[${index}]`));
  for (const [index, artifact] of (catalog?.platformArtifacts ?? []).entries()) {
    const path = `platformArtifacts[${index}]`;
    if (!artifact?.package) failures.push(`${path}.package: required`);
    if (!EXACT_VERSION.test(artifact?.version ?? "")) failures.push(`${path}.version: must be exact`);
    if (!INTEGRITY.test(artifact?.integrity ?? "")) failures.push(`${path}.integrity: invalid sha512`);
    if (artifact?.adapter !== "infrastructure/upstream-ruvector") failures.push(`${path}.adapter: invalid`);
    if (!/^(any|linux-(?:x64|arm64)-gnu)$/.test(artifact?.platform ?? "")) failures.push(`${path}.platform: invalid`);
  }
  for (const [index, source] of (catalog?.sourceAuthorities ?? []).entries()) {
    const path = `sourceAuthorities[${index}]`;
    if (!source?.name || !NAME.test(source.name)) failures.push(`${path}.name: invalid`);
    if (!/^https:\/\/github\.com\/ruvnet\/[A-Za-z0-9._-]+\.git$/.test(source?.repository ?? "")) failures.push(`${path}.repository: unapproved source`);
    if (!/^[a-f0-9]{40}$/.test(source?.commit ?? "")) failures.push(`${path}.commit: expected full commit SHA`);
    if (!/^[a-f0-9]{40}$/.test(source?.sourceTree ?? "")) failures.push(`${path}.sourceTree: expected git tree SHA`);
    if (typeof source?.path !== "string" || source.path.includes("..")) failures.push(`${path}.path: invalid`);
    if (typeof source?.build !== "string" || !source.build.includes("--locked")) failures.push(`${path}.build: must be locked`);
    if (typeof source?.binary !== "string" || source.binary.startsWith("/")) failures.push(`${path}.binary: invalid`);
    nonEmptyStrings(source?.requiredCapabilities, `${path}.requiredCapabilities`, failures);
    const mapped = source?.capabilityTests;
    if (!mapped || JSON.stringify(Object.keys(mapped).sort()) !== JSON.stringify([...source.requiredCapabilities].sort()))
      failures.push(`${path}.capabilityTests: keys must exactly match requiredCapabilities`);
    nonEmptyStrings(source?.contractTests, `${path}.contractTests`, failures);
    if (!Array.isArray(source?.deviations)) failures.push(`${path}.deviations: expected an array`);
  }
  const entries = [...(catalog?.authorities ?? []), ...(catalog?.hosts ?? [])];
  for (const key of ["name", "package"])
    if (new Set(entries.map((entry) => entry[key])).size !== entries.length) failures.push(`${key}: duplicate catalog entry`);
  for (const entry of entries)
    for (const testPath of entry.contractTests ?? [])
      try { await access(testPath); } catch { failures.push(`${entry.name}: contract test missing: ${testPath}`); }
  for (const source of catalog?.sourceAuthorities ?? [])
    for (const testPath of source.contractTests ?? [])
      try { await access(testPath); } catch { failures.push(`${source.name}: contract test missing: ${testPath}`); }
  for (const entry of [...(catalog?.authorities ?? []), ...(catalog?.sourceAuthorities ?? [])]) {
    const texts = await Promise.all((entry.contractTests ?? []).map((testPath) => readFile(testPath, "utf8").catch(() => "")));
    for (const testId of Object.values(entry.capabilityTests ?? {}))
      if (!texts.some((testText) => testText.includes(JSON.stringify(testId)))) failures.push(`${entry.name}: executable test id not found: ${testId}`);
  }
  return { catalog, text, failures };
}

export function lockEntry(lock, packageName) {
  return lock.packages?.[`node_modules/${packageName}`];
}
