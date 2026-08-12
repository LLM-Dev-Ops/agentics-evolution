import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createSigner, sha256, signEnvelope } from "./lib/evidence.mjs";

const required = [
  "reports/sbom.cdx.json",
  "reports/conformance.json",
  "reports/dependency-inventory.json",
  "reports/license-report.json",
  "reports/native-inventory.json",
  "reports/audit-production.json",
  "reports/tests.tap.txt"
];
const subjects = [];
for (const path of required) subjects.push({ path, sha256: sha256(await readFile(path)) });
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) throw new Error("refusing provenance generation from a dirty tracked worktree");
const statement = {
  schemaVersion: "agentics.provenance/v1",
  predicateType: "https://slsa.dev/provenance/v1",
  source: { repository: "https://github.com/LLM-Dev-Ops/agentics-evolution", commit },
  toolchain: { node: process.version, npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim() },
  invocation: { command: "npm run verify:prompt-01", environment: "clean-ci" },
  subjects
};
const signer = createSigner(process.env.AGENTICS_RELEASE_PRIVATE_KEY);
await writeFile("reports/provenance.signed.json", `${JSON.stringify(signEnvelope(statement, signer), null, 2)}\n`);
