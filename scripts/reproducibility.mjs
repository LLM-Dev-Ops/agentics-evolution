import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./lib/evidence.mjs";

const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
if (process.version !== "v20.19.5" || npmVersion !== "10.9.4")
  throw new Error(`clean verification requires Node v20.19.5/npm 10.9.4, received ${process.version}/npm ${npmVersion}`);

async function files(root, relative = "dist") {
  const directory = join(root, relative);
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, path));
    else result.push({ path, sha256: sha256(await readFile(join(root, path))) });
  }
  return result;
}

async function cleanRun(parent, iteration) {
  const root = join(parent, `checkout-${iteration}`);
  execFileSync("mkdir", [root]);
  const archive = execFileSync("git", ["archive", "--format=tar", "HEAD"], { maxBuffer: 50 * 1024 * 1024 });
  execFileSync("tar", ["-xf", "-", "-C", root], { input: archive });
  const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  execFileSync("npm", ["ci", "--include=optional", "--ignore-scripts"], options);
  execFileSync("npm", ["run", "build"], options);
  execFileSync("npm", ["test"], options);
  const outputs = await files(root);
  return { iteration, outputDigest: sha256(JSON.stringify(outputs)), outputs };
}

const parent = await mkdtemp(join(tmpdir(), "agentics-repro-"));
try {
  const runs = [await cleanRun(parent, 1), await cleanRun(parent, 2)];
  if (runs[0].outputDigest !== runs[1].outputDigest) throw new Error("clean checkout build outputs are not reproducible");
  await writeFile("reports/reproducibility.json", `${JSON.stringify({
    schemaVersion: "agentics.reproducibility/v1",
    toolchain: { node: process.version, npm: npmVersion },
    cleanCheckouts: 2,
    outputDigest: runs[0].outputDigest,
    outputs: runs[0].outputs,
    passed: true
  }, null, 2)}\n`);
  console.log(`two clean checkout installs/builds/tests reproduced ${runs[0].outputDigest}`);
} finally {
  await rm(parent, { recursive: true, force: true });
}
