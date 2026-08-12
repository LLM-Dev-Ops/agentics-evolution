import { readFile } from "node:fs/promises";
import { platformGraphFailures } from "./lib/sbom.mjs";

const sbom = JSON.parse(await readFile("reports/sbom.cdx.json", "utf8"));
if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6") throw new Error("CycloneDX 1.6 SBOM required");
if (!Array.isArray(sbom.components) || sbom.components.length === 0) throw new Error("SBOM contains no components");
const refs = new Set();
for (const component of sbom.components) {
  if (!component["bom-ref"] || refs.has(component["bom-ref"])) throw new Error("SBOM component references must be present and unique");
  refs.add(component["bom-ref"]);
  if (!component.name || !component.version) throw new Error("SBOM component lacks name or version");
}
const platformCount = Number(sbom.metadata?.properties?.find(({ name }) => name === "agentics:platform-component-count")?.value);
if (!Number.isInteger(platformCount) || platformCount < 1) throw new Error("merged platform SBOM evidence is required");
const graphFailures = platformGraphFailures(sbom);
if (graphFailures.length) throw new Error(graphFailures.join("\n"));
console.log(`validated CycloneDX SBOM with ${refs.size} components`);
