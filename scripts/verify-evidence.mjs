import { readFile } from "node:fs/promises";
import { requireTrustedPublicKey, sha256, validateSlsaV1, verifyEnvelope } from "./lib/evidence.mjs";

const envelope = JSON.parse(await readFile(process.argv[2] ?? "reports/provenance.signed.json", "utf8"));
const mode = process.env.AGENTICS_EVIDENCE_MODE ?? "production";
const trustedKey = requireTrustedPublicKey(process.env.AGENTICS_RELEASE_PUBLIC_KEY, mode, envelope.publicKey);
const statement = validateSlsaV1(verifyEnvelope(envelope, trustedKey));
for (const subject of statement.subject) {
  const actual = sha256(await readFile(subject.name));
  if (actual !== subject.digest?.sha256) throw new Error(`${subject.name}: digest does not match signed provenance`);
}
const commit = statement.predicate.buildDefinition.externalParameters.source.digest.gitCommit;
console.log(`verified ${statement.subject.length} evidence subjects for ${commit}`);
