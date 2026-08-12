import test from "node:test";
import assert from "node:assert/strict";
import { mergeSboms, platformGraphFailures } from "../scripts/lib/sbom.mjs";

const base = { components: [], dependencies: [], metadata: { properties: [] } };
const platform = {
  serialNumber: "urn:uuid:fixture", metadata: { component: { "bom-ref": "platform@0" } },
  components: [{ "bom-ref": "platform@0|native@1", name: "native", version: "1" }],
  dependencies: [{ ref: "platform@0", dependsOn: ["platform@0|native@1"] }, { ref: "platform@0|native@1" }]
};

test("merged SBOM preserves selected platform dependency edges", () => {
  assert.deepEqual(platformGraphFailures(mergeSboms(base, platform)), []);
});

test("missing selected platform dependency edges are rejected", () => {
  const merged = mergeSboms(base, platform);
  merged.dependencies = merged.dependencies.filter(({ ref }) => ref !== "platform@0|native@1");
  assert.match(platformGraphFailures(merged).join("\n"), /dependency edge is missing/);
});
