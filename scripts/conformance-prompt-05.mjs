import { mkdir, readFile, writeFile } from "node:fs/promises";
const execution=JSON.parse(await readFile("reports/test-execution.json","utf8"));if(execution.status!==0)throw new Error("PROMPT_05_TEST_EVIDENCE_FAILED");
const controls=[
 ["ADR-006.ACTIONS","governance-domain.test.mjs","all named actions and deny-safe envelope algebra"],
 ["ADR-006.APPROVAL","governance-postgres-live.test.mjs","SoD, bounded concurrent consumption, RLS and audit/outbox"],
 ["ADR-006.IDENTITY","governance-identity-privacy.test.mjs","signed OIDC, audience, time, MFA and server mappings"],
 ["ADR-006.BUDGET","budget-saga-live.test.mjs","ledger-backed idempotent reservation and reconciliation"],
 ["ADR-020.PRIVACY","governance-privacy-scanner.test.mjs","secret prohibition and PII redaction"],
 ["ADR-020.DELETION","governance-deletion-postgres.test.mjs","tombstone-first resumable deletion and signed receipt"],
 ["ADR-010.AUTHZ","governance-identity-privacy.test.mjs","authentication delegates exactly once to Governance"],
 ["ADR-006.POLICY","policy-decision-service.test.mjs","11-action truth table, precedence and outage behavior"],
 ["ADR-006.DELEGATION","governance-approval-remediation.test.mjs","verified approval and transitive revocation"],
 ["ADR-020.BOUNDARIES","governance-deletion-boundaries-live.test.mjs","real owned-boundary purge and tombstoned ingress"]
].map(([requirement,test,claim])=>{const path=`test/${test}`;if(!execution.files.includes(path))throw new Error(`PROMPT_05_TEST_NOT_EXECUTED:${path}`);return {requirement,test,claim,status:"EXECUTED"};});await mkdir("reports",{recursive:true});await writeFile("reports/prompt-05-conformance.json",`${JSON.stringify({schema:"agentics.prompt-05-conformance/v1",executionEvidence:"reports/test-execution.json",controls},null,2)}\n`);
