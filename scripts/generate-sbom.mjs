import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("reports", { recursive: true });
execFileSync("cyclonedx-npm", ["--output-file", "reports/sbom-base.cdx.json", "--output-format", "JSON", "--spec-version", "1.6"], { stdio: "inherit" });
execFileSync("cyclonedx-npm", ["--output-file", "../reports/sbom-platform.cdx.json", "--output-format", "JSON", "--spec-version", "1.6"], { cwd: ".agentics-platform", stdio: "inherit" });
const base = JSON.parse(await readFile("reports/sbom-base.cdx.json", "utf8"));
const platform = JSON.parse(await readFile("reports/sbom-platform.cdx.json", "utf8"));
const components = new Map();
for (const component of [...(base.components ?? []), ...(platform.components ?? [])])
  components.set(component["bom-ref"], component);
base.components = [...components.values()].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
base.metadata.properties = [
  ...(base.metadata.properties ?? []),
  { name: "agentics:platform-sbom-serial", value: platform.serialNumber },
  { name: "agentics:platform-component-count", value: String(platform.components?.length ?? 0) }
];
await writeFile("reports/sbom.cdx.json", `${JSON.stringify(base, null, 2)}\n`);
