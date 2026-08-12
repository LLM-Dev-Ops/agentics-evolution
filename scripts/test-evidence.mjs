import { spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";

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
await writeFile("reports/tests.tap.txt", `${run.stdout}${run.stderr}`);
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
