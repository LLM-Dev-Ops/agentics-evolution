import { mkdir, readFile, writeFile } from "node:fs/promises";
import { validateTapEvidence } from "./lib/tap-evidence.mjs";
const execution=JSON.parse(await readFile("reports/test-execution.json","utf8"));if(execution.schema!=="agentics.test-execution/v2"||execution.status!==0)throw new Error("PROMPT_05_TEST_EVIDENCE_FAILED");
const controls=[
 ["PROMPT-05.EVIDENCE_SEMANTICS","evidence-semantics.test.mjs","evidence semantics reject failed, skipped, and missing required assertions"],
 ["ADR-006.ACTIONS","governance-domain.test.mjs","seeded 10k shrinking property preserves subset transitivity"],
 ["ADR-006.APPROVAL","governance-postgres-live.test.mjs","live PG authorization bounds 100 concurrent consumers and isolates tenants"],
 ["ADR-006.IDENTITY","governance-identity-privacy.test.mjs","cryptographic OIDC verifies human MFA and server-side service mappings"],
 ["ADR-010.GOOGLE_IDENTITY","oidc-rs256.test.mjs","Google RS256 service tokens require exact server mapping"],
 ["ADR-006.BUDGET","budget-saga-live.test.mjs","ledger.reserve.behavior: 100 distinct saga IDs share the real authoritative organization ceiling"],
 ["ADR-020.PRIVACY","governance-privacy-scanner.test.mjs","credential and PII corpus is prohibited or redacted without raw persistence material"],
 ["ADR-020.DELETION","governance-deletion-postgres.test.mjs","live PG tombstone blocks writes and deletion resumes idempotently to a signed receipt"],
 ["ADR-010.AUTHZ","governance-identity-privacy.test.mjs","authentication cannot grant capability and middleware delegates exactly once to Governance"],
 ["ADR-006.POLICY","policy-decision-service.test.mjs","all 11 governance actions obey allow/default-deny/deny-override and approval truth table"],
 ["ADR-006.DELEGATION","governance-approval-remediation.test.mjs","delegation resolution invalidates descendants when any ancestor expires, is revoked, or changes epoch"],
 ["ADR-020.BOUNDARIES","governance-deletion-boundaries-live.test.mjs","owned deletion boundaries purge projections/events/CAS refs and tombstone every ingress"]
].map(([requirement,test,assertion])=>({requirement,test,assertion}));validateTapEvidence(execution.semantics,controls.map(({assertion})=>assertion));for(const {test} of controls){const path=`test/${test}`;if(!execution.files.includes(path))throw new Error(`PROMPT_05_TEST_NOT_EXECUTED:${path}`);}await mkdir("reports",{recursive:true});await writeFile("reports/prompt-05-conformance.json",`${JSON.stringify({schema:"agentics.prompt-05-conformance/v2",executionEvidence:"reports/test-execution.json",controls:controls.map(control=>({...control,status:"EXECUTED_AND_PASSED"}))},null,2)}\n`);
