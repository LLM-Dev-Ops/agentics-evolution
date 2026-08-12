import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { loadAuthorityCatalog, lockEntry } from "./authority-catalog.mjs";

const execFileAsync = promisify(execFile);
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const { catalog, text, failures } = await loadAuthorityCatalog();
const results = [];

async function moduleExports(packageName) {
  const script = `import(${JSON.stringify(packageName)}).then(m=>process.stdout.write('@@AGENTICS_PROBE@@'+JSON.stringify({exports:Object.keys(m).sort(),runtime:${JSON.stringify(packageName)}==='ruvector'?{native:m.isNativeAvailable(),rvf:m.isRvfAvailable(),sona:m.isSonaAvailable()}:null})))`;
  const { stdout } = await execFileAsync(process.execPath, ["--no-warnings", "--input-type=module", "--eval", script], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, RUVECTOR_LOG_LEVEL: "silent" }
  });
  const marker = "@@AGENTICS_PROBE@@";
  const jsonStart = stdout.lastIndexOf(marker);
  if (jsonStart < 0) throw new Error("module probe emitted no export inventory");
  return JSON.parse(stdout.slice(jsonStart + marker.length));
}

async function cliCapabilities(packageName) {
  const executable = lockEntry(lock, packageName)?.bin;
  const binName = typeof executable === "string" ? packageName : Object.keys(executable ?? {})[0];
  if (!binName) throw new Error("package exposes no CLI binary");
  const binPath = `node_modules/.bin/${binName}`;
  const { stdout } = await execFileAsync(binPath, ["--help"], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  return stdout;
}

for (const entry of [...catalog.authorities, ...catalog.hosts]) {
  const entryFailures = [];
  const installed = lockEntry(lock, entry.package);
  if (!installed) entryFailures.push("not installed in lockfile");
  if (installed?.version !== entry.version) entryFailures.push(`resolved ${installed?.version ?? "missing"}, expected ${entry.version}`);
  if (installed?.integrity !== entry.integrity) entryFailures.push("lockfile integrity differs from authority catalog");
  if (manifest.dependencies?.[entry.package] !== entry.version) entryFailures.push("package manifest version differs from catalog");
  let availableExports = [];
  let availableCapabilities = [];
  try {
    if (entry.probe === "cli") {
      const help = await cliCapabilities(entry.package);
      availableCapabilities = entry.requiredCapabilities.filter((capability) => new RegExp(`\\b${capability}\\b`, "i").test(help));
    } else {
      const inventory = await moduleExports(entry.package);
      availableExports = inventory.exports;
      availableCapabilities = (entry.requiredCapabilities ?? []).filter((_, index) => availableExports.includes(entry.requiredExports[index]));
      if (entry.name === "ruvector") {
        availableCapabilities = [
          ...(inventory.runtime?.sona ? ["sona"] : []),
          ...(inventory.runtime?.rvf ? ["rvf"] : []),
          ...(availableExports.includes("getVersion") ? ["version"] : []),
          ...(inventory.runtime?.native ? ["native"] : [])
        ];
      }
      for (const required of entry.requiredExports)
        if (!availableExports.includes(required)) entryFailures.push(`required export missing: ${required}`);
    }
  } catch (error) {
    entryFailures.push(`runtime probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const capability of entry.requiredCapabilities ?? [])
    if (!availableCapabilities.includes(capability)) entryFailures.push(`required capability missing: ${capability}`);
  failures.push(...entryFailures.map((failure) => `${entry.name}: ${failure}`));
  results.push({
    name: entry.name,
    package: entry.package,
    requestedVersion: entry.version,
    resolvedVersion: installed?.version ?? null,
    integrity: installed?.integrity ?? null,
    requiredExports: entry.requiredExports,
    availableExports,
    requiredCapabilities: entry.requiredCapabilities ?? [],
    availableCapabilities,
    passed: entryFailures.length === 0
  });
}

const report = {
  schemaVersion: "agentics.upstream-probes/v1",
  generatedAt: new Date().toISOString(),
  catalogDigest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
  passed: failures.length === 0,
  failures,
  results
};
await writeFile("reports/upstream-probes.json", `${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
