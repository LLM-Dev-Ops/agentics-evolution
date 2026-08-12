import { spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { parseTapEvidence, validateTapEvidence } from "./lib/tap-evidence.mjs";

const selected = process.env.AGENTICS_TEST_FILES?.split(",").filter(Boolean);
const files = (selected ?? (await readdir("test"))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => `test/${file}`));
const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
  encoding: "utf8",
  env: { ...process.env, FORCE_COLOR: "0" }
});
await mkdir("reports", { recursive: true });
const tap=`${run.stdout}${run.stderr}`;await writeFile("reports/tests.tap.txt",tap);
let semantics;try{semantics=validateTapEvidence(parseTapEvidence(tap),[],{allowDirectives:!selected});}catch(error){semantics={validationError:error instanceof Error?error.message:String(error)};}
await writeFile("reports/test-execution.json", `${JSON.stringify({ schema:"agentics.test-execution/v2",files,status:run.status,semantics,executedAt:new Date().toISOString() },null,2)}\n`);
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
if("validationError" in semantics)throw new Error(semantics.validationError);
