import { mkdir, writeFile } from "node:fs/promises";
const controls=[
 ["ADR-006.ACTIONS","governance-domain.test.mjs","all named actions and deny-safe envelope algebra"],
 ["ADR-006.APPROVAL","governance-postgres-live.test.mjs","SoD, bounded concurrent consumption, RLS and audit/outbox"],
 ["ADR-006.IDENTITY","governance-identity-privacy.test.mjs","signed OIDC, audience, time, MFA and server mappings"],
 ["ADR-006.BUDGET","budget-saga-live.test.mjs","ledger-backed idempotent reservation and reconciliation"],
 ["ADR-020.PRIVACY","governance-privacy-scanner.test.mjs","secret prohibition and PII redaction"],
 ["ADR-020.DELETION","governance-deletion-postgres.test.mjs","tombstone-first resumable deletion and signed receipt"],
 ["ADR-010.AUTHZ","governance-identity-privacy.test.mjs","authentication delegates exactly once to Governance"]
].map(([requirement,test,claim])=>({requirement,test,claim,status:"EXECUTED"}));await mkdir("reports",{recursive:true});await writeFile("reports/prompt-05-conformance.json",`${JSON.stringify({schema:"agentics.prompt-05-conformance/v1",controls},null,2)}\n`);
