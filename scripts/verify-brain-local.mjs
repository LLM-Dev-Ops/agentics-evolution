import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
await exec(process.execPath, ["scripts/build-brain-local.mjs"], { timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 });
const evidence = JSON.parse(await readFile("reports/brain-local-build.json", "utf8"));
const result = await exec(process.execPath, ["--test", "test/brain-local-contract.test.mjs"], {
  timeout: 60_000,
  maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, BRAIN_LOCAL_BINARY: evidence.binary }
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
