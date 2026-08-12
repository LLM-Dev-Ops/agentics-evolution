import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { createSigner, sha256, signEnvelope } from "./lib/evidence.mjs";

const required = [
  "reports/sbom.cdx.json",
  "reports/conformance.json",
  "reports/dependency-inventory.json",
  "reports/license-report.json",
  "reports/native-inventory.json",
  "reports/audit-production.json",
  "reports/audit-platform.json",
  "reports/sbom-base.cdx.json",
  "reports/sbom-platform.cdx.json",
  "reports/tests.tap.txt"
];
const subjects = [];
for (const path of required) subjects.push({ path, sha256: sha256(await readFile(path)) });
const prompt02 = process.env.AGENTICS_BUILD_PROMPT === "02";
const prompt03 = process.env.AGENTICS_BUILD_PROMPT === "03";
const prompt04 = process.env.AGENTICS_BUILD_PROMPT === "04";
for (const path of ["reports/prompt-02-benchmark.json", "reports/prompt-02-ddd-boundaries.json", "reports/prompt-02-properties.json"]) {
  const exists = await access(path).then(() => true, () => false);
  if (prompt02 && !exists) throw new Error(`Prompt 02 provenance requires ${path}`);
  if (exists && prompt02) subjects.push({ path, sha256: sha256(await readFile(path)) });
}
if (prompt03) for (const path of ["reports/prompt-03-postgres.json", "reports/prompt-03-benchmark.json"])
  subjects.push({ path, sha256: sha256(await readFile(path)) });
if (prompt04) for (const path of ["reports/prompt-04-benchmark.json"])
  subjects.push({ path, sha256: sha256(await readFile(path)) });
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) throw new Error("refusing provenance generation from a dirty tracked worktree");
const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
const statement = {
  _type: "https://in-toto.io/Statement/v1",
  subject: subjects.map(({ path, sha256: digest }) => ({ name: path, digest: { sha256: digest } })),
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: prompt04 ? "https://agentics.dev/build-types/prompt-04-evidence/v1" : prompt03 ? "https://agentics.dev/build-types/prompt-03-evidence/v1" : prompt02 ? "https://agentics.dev/build-types/prompt-02-evidence/v1" : "https://agentics.dev/build-types/prompt-01-evidence/v1",
      externalParameters: { source: { uri: "git+https://github.com/LLM-Dev-Ops/agentics-evolution", digest: { gitCommit: commit } } },
      internalParameters: { command: prompt04 ? "npm run verify:prompt-04" : prompt03 ? "npm run verify:prompt-03" : prompt02 ? "npm run verify:prompt-02" : "npm run verify:prompt-01", evidenceMode: process.env.AGENTICS_EVIDENCE_MODE ?? "production" },
      resolvedDependencies: [
        { uri: "pkg:generic/node", digest: { version: process.version } },
        { uri: "pkg:npm/npm", digest: { version: npmVersion } }
      ]
    },
    runDetails: {
      builder: { id: "https://github.com/LLM-Dev-Ops/agentics-evolution/.github/workflows/verify.yml" },
      metadata: { invocationId: `${commit}:prompt-01`, startedOn: new Date().toISOString(), finishedOn: new Date().toISOString() }
    }
  }
};
const mode = process.env.AGENTICS_EVIDENCE_MODE ?? "production";
if (!process.env.AGENTICS_RELEASE_PRIVATE_KEY && !["development", "test"].includes(mode))
  throw new Error("production provenance requires AGENTICS_RELEASE_PRIVATE_KEY");
const signer = createSigner(process.env.AGENTICS_RELEASE_PRIVATE_KEY);
await writeFile("reports/provenance.signed.json", `${JSON.stringify(signEnvelope(statement, signer), null, 2)}\n`);
