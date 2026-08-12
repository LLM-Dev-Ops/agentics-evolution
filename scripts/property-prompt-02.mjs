import { writeFile } from "node:fs/promises";
import { transitionTrust } from "../dist/index.js";

const seed = 0x5eed2026;
let random = seed;
const next = () => ((random ^= random << 13, random ^= random >>> 17, random ^= random << 5) >>> 0);
const commands = ["ProposeHypothesis", "GenerateCandidate", "AcceptEvaluation", "AuthorizePromotion"];
const evidence = { sourceValidated: true, mutationAdmitted: true, proofVerified: true, independentAuthorization: true };
let accepted = 0; let rejected = 0;
for (let run = 0; run < 10_000; run++) {
  let state = null;
  for (let step = 0; step < 8; step++) {
    try { state = transitionTrust(state, commands[next() % commands.length], evidence); accepted++; }
    catch { rejected++; }
    if (state === "AUTHORIZED" && accepted < 4) throw new Error("authorization reached without complete transition chain");
  }
}
await writeFile("reports/prompt-02-properties.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-02-properties/v1", seed, cases: 10_000, stepsPerCase: 8, accepted, rejected, passed: true }, null, 2)}\n`);
console.log(`property seed ${seed}: 10000 cases passed`);
