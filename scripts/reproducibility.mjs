import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./lib/evidence.mjs";

const ignored = new Set([".git", "node_modules", "dist", "reports"]);
async function collect(root = ".") {
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (root === "." && ignored.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await collect(path));
    else result.push({ path, sha256: sha256(await readFile(path)) });
  }
  return result;
}

const first = await collect();
const second = await collect();
const firstDigest = sha256(JSON.stringify(first));
const secondDigest = sha256(JSON.stringify(second));
if (firstDigest !== secondDigest) throw new Error("source inputs changed during reproducibility capture");
await writeFile("reports/reproducibility.json", `${JSON.stringify({
  schemaVersion: "agentics.reproducibility/v1",
  inputDigest: firstDigest,
  repeatedInputDigest: secondDigest,
  files: first.length,
  passed: true
}, null, 2)}\n`);
console.log(`reproducible source manifest ${firstDigest} (${first.length} files)`);
