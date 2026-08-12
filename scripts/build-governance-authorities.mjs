import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const processExists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; } };
async function acquireLease(path, timeoutMs = 12 * 60_000) {
  const started=Date.now();
  while (true) {
    try { await mkdir(path);await writeFile(join(path,"owner.json"),JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));return async()=>rm(path,{recursive:true,force:true}); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let stale=false;
      try { const owner=JSON.parse(await readFile(join(path,"owner.json"),"utf8"));const age=Date.now()-Date.parse(owner.createdAt);stale=age>15*60_000||(!processExists(owner.pid)&&age>5_000); }
      catch { try { stale=Date.now()-(await stat(path)).mtimeMs>15*60_000; } catch { continue; } }
      if(stale){await rm(path,{recursive:true,force:true});continue;}
      if(Date.now()-started>timeoutMs)throw new Error(`authority cache lease timeout: ${path}`);
      await delay(50+Math.floor(Math.random()*100));
    }
  }
}
const evidence = [];
for (const source of sources) {
  const checkout = join(root, `${source.name}-${source.commit}`);
  const release=await acquireLease(`${checkout}.lock`);
  try {
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
  } finally { await release(); }
}
await mkdir("reports", { recursive: true });const reportPath="reports/governance-authority-builds.json";const temporaryReport=`${reportPath}.${process.pid}.${crypto.randomUUID()}.tmp`;await writeFile(temporaryReport, `${JSON.stringify({ schemaVersion: "agentics.source-build/v1", authorities: evidence }, null, 2)}\n`);await rename(temporaryReport,reportPath);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
