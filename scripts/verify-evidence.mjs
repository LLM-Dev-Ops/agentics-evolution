import { readFile } from "node:fs/promises";
import { sha256, verifyEnvelope } from "./lib/evidence.mjs";

const envelope = JSON.parse(await readFile(process.argv[2] ?? "reports/provenance.signed.json", "utf8"));
const statement = verifyEnvelope(envelope, process.env.AGENTICS_RELEASE_PUBLIC_KEY);
if (statement.schemaVersion !== "agentics.provenance/v1") throw new Error("unsupported provenance statement");
for (const subject of statement.subjects) {
  const actual = sha256(await readFile(subject.path));
  if (actual !== subject.sha256) throw new Error(`${subject.path}: digest does not match signed provenance`);
}
console.log(`verified ${statement.subjects.length} evidence subjects for ${statement.source.commit}`);
