import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadAuthorityCatalog } from "./authority-catalog.mjs";

const exec = promisify(execFile); const { catalog, failures } = await loadAuthorityCatalog();
if (failures.length) throw new Error(failures.join("\n"));
const names = new Set(["agentics-contracts", "agentics-policy-engine", "agentics-enforcement", "agentics-usage-ledger"]);
const sources = catalog.sourceAuthorities.filter(({ name }) => names.has(name));
if (sources.length !== names.size) throw new Error("governance source authority catalog incomplete");
const root = resolve(process.env.AGENTICS_UPSTREAM_CACHE ?? join(homedir(), ".cache", "agentics-evolution", "upstreams")); await mkdir(root, { recursive: true });
const evidence = [];
for (const source of sources) {
  const checkout = join(root, `${source.name}-${source.commit}`);
  try { await exec("git", ["-C", checkout, "rev-parse", "--git-dir"]); }
  catch { await exec("git", ["clone", "--filter=blob:none", "--no-checkout", source.repository, checkout], { maxBuffer: 8_000_000 }); }
  await exec("git", ["-C", checkout, "fetch", "--depth=1", "origin", source.commit]);
  await exec("git", ["-C", checkout, "checkout", "--detach", "--force", source.commit]);
  const head = (await exec("git", ["-C", checkout, "rev-parse", "HEAD"])).stdout.trim();
  const tree = (await exec("git", ["-C", checkout, "rev-parse", "HEAD^{tree}"])).stdout.trim();
  if (head !== source.commit || tree !== source.sourceTree) throw new Error(`${source.name}: source integrity mismatch`);
  try { await access(join(checkout, "package-lock.json")); }
  catch { evidence.push({ name: source.name, repository: source.repository, commit: head, sourceTree: tree, status: "SOURCE_LOCKFILE_MISSING" }); continue; }
  try {
    await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: checkout, timeout: 10 * 60_000, maxBuffer: 16_000_000 });
    await exec("npm", ["run", "build"], { cwd: checkout, timeout: 10 * 60_000, maxBuffer: 16_000_000 });
    const artifact = join(checkout, source.binary); await readFile(artifact);
    evidence.push({ name: source.name, repository: source.repository, commit: head, sourceTree: tree, artifact, status: "BUILT" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    evidence.push({ name: source.name, repository: source.repository, commit: head, sourceTree: tree, status: "BUILD_DEPENDENCY_UNAVAILABLE", detail: detail.slice(0, 500) });
  }
}
await mkdir("reports", { recursive: true }); await writeFile("reports/governance-authority-builds.json", `${JSON.stringify({ schemaVersion: "agentics.source-build/v1", authorities: evidence }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
