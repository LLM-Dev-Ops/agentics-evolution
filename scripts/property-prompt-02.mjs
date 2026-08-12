import { writeFile } from "node:fs/promises";
import { transitionTrust } from "../dist/index.js";

const seed = 0x5eed2026;
let random = seed;
const next = () => ((random ^= random << 13, random ^= random >>> 17, random ^= random << 5) >>> 0);
const commands = ["ProposeHypothesis", "GenerateCandidate", "AcceptEvaluation", "AuthorizePromotion"];
let accepted = 0; let rejected = 0;
for (let run = 0; run < 10_000; run++) {
  let state = null;
  let modelIndex = -1;
  const trace = [];
  for (let step = 0; step < 8; step++) {
    const command = commands[next() % commands.length];
    const includeGate = (next() & 1) === 1;
    const evidence = command === "ProposeHypothesis" ? { sourceValidated: includeGate || undefined }
      : command === "GenerateCandidate" ? { mutationAdmitted: includeGate || undefined }
      : command === "AcceptEvaluation" ? { proofVerified: includeGate || undefined } : { independentAuthorization: includeGate || undefined };
    const shouldAccept = includeGate && commands[modelIndex + 1] === command;
    trace.push({ command, includeGate, prior: state });
    try {
      state = transitionTrust(state, command, evidence);
      if (!shouldAccept) throw new Error(`model mismatch seed=${seed} run=${run} trace=${JSON.stringify(trace)}`);
      modelIndex++; accepted++;
    } catch (error) {
      if (shouldAccept || String(error).includes("model mismatch")) throw error;
      rejected++;
    }
    if (state !== (modelIndex < 0 ? null : ["IMAGINED", "PRODUCED", "PROVED", "AUTHORIZED"][modelIndex]))
      throw new Error(`state/model mismatch seed=${seed} run=${run} trace=${JSON.stringify(trace)}`);
  }
}
await writeFile("reports/prompt-02-properties.json", `${JSON.stringify({ schemaVersion: "agentics.prompt-02-properties/v1", seed, cases: 10_000, stepsPerCase: 8, accepted, rejected, passed: true }, null, 2)}\n`);
console.log(`property seed ${seed}: 10000 cases passed`);
