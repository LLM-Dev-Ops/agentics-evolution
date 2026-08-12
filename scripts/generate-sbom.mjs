import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mergeSboms } from "./lib/sbom.mjs";

await mkdir("reports", { recursive: true });
execFileSync("cyclonedx-npm", ["--output-file", "reports/sbom-base.cdx.json", "--output-format", "JSON", "--spec-version", "1.6"], { stdio: "inherit" });
execFileSync("cyclonedx-npm", ["--output-file", "../reports/sbom-platform.cdx.json", "--output-format", "JSON", "--spec-version", "1.6"], { cwd: ".agentics-platform", stdio: "inherit" });
const base = JSON.parse(await readFile("reports/sbom-base.cdx.json", "utf8"));
const platform = JSON.parse(await readFile("reports/sbom-platform.cdx.json", "utf8"));
await writeFile("reports/sbom.cdx.json", `${JSON.stringify(mergeSboms(base, platform), null, 2)}\n`);
