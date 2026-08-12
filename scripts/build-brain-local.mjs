import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadAuthorityCatalog } from "./authority-catalog.mjs";

const exec = promisify(execFile);
const { catalog, failures } = await loadAuthorityCatalog();
if (failures.length) throw new Error(failures.join("\n"));
const source = catalog.sourceAuthorities.find((entry) => entry.name === "ruvector-brain-local");
if (!source) throw new Error("ruvector-brain-local source authority missing");
const cacheRoot = resolve(process.env.AGENTICS_UPSTREAM_CACHE ?? join(homedir(), ".cache", "agentics-evolution", "upstreams"));
const checkout = join(cacheRoot, `ruvector-${source.commit}`);
await mkdir(cacheRoot, { recursive: true });
try {
  await exec("git", ["-C", checkout, "rev-parse", "--git-dir"]);
} catch {
  await exec("git", ["clone", "--filter=blob:none", "--no-checkout", source.repository, checkout], { maxBuffer: 8 * 1024 * 1024 });
}
await exec("git", ["-C", checkout, "fetch", "--depth=1", "origin", source.commit]);
await exec("git", ["-C", checkout, "checkout", "--detach", "--force", source.commit]);
const { stdout: head } = await exec("git", ["-C", checkout, "rev-parse", "HEAD"]);
const { stdout: tree } = await exec("git", ["-C", checkout, "rev-parse", `HEAD:${source.path}`]);
if (head.trim() !== source.commit) throw new Error(`source commit mismatch: ${head.trim()}`);
if (tree.trim() !== source.sourceTree) throw new Error(`source tree mismatch: ${tree.trim()}`);
await exec("cargo", ["build", "--locked", "--release", "-p", "mcp-brain-server", "--features", "local", "--bin", "mcp-brain-server-local"], {
  cwd: checkout,
  timeout: 30 * 60_000,
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse" }
});
const binary = join(checkout, source.binary);
await readFile(binary);
const evidence = { schemaVersion: "agentics.source-build/v1", name: source.name, repository: source.repository, commit: source.commit, sourceTree: source.sourceTree, binary };
await writeFile("reports/brain-local-build.json", `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${binary}\n`);
