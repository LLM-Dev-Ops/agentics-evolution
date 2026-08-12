# Agentics Evolution implementation prompts

These prompts implement the decisions in this directory in dependency order. Run one prompt at a time. Do not begin a prompt until every exit gate from its prerequisites is satisfied and committed. A later prompt may refine an adapter, but it may not reinterpret an earlier ADR or weaken an earlier test.

## Instructions that apply to every prompt

Copy this block into every implementation session:

> Work in `/workspace/agentics-dev/agentics-evolution`. Read `research.md`, `docs/plans/README.md`, `docs/plans/implementation-plan.md`, every ADR and DDD named by this prompt, and repository instructions before changing files. Treat accepted ADRs as authoritative. If two records conflict, stop and report the conflict; do not improvise. Use exact pinned Ruvnet packages and their public APIs. Do not reimplement Ruflo orchestration, MetaHarness analysis, Darwin mutation/search/safety, Flywheel gates/receipts/lineage/replay, RedBlue, turn-credit, RuVector Brain/RVF/SONA, or their algorithms. Domain code may call them only through the anti-corruption ports defined by DDD-008. Preserve trust separation: Dream imagines, Darwin produces, Flywheel proves, Governance authorizes. Implement production behavior and failure paths, not scaffolding. Use real services in integration tests where the ADR requires them; mocks may exist only for unit tests and cannot be the acceptance evidence. Validate inputs at boundaries, keep files under 500 lines, avoid secrets, update traceability, and run focused plus regression tests. Do not mark an ADR implemented until all of its acceptance criteria have executable passing evidence. Do not commit, push, deploy, publish, create GitHub resources, or mutate external infrastructure unless the user explicitly authorizes that action in the implementation turn.

## Prompt 01 — Establish the reproducible Ruvnet foundation

**Prerequisites:** none.

**Governing records:** ADR-001, ADR-009, ADR-023; DDD-001, DDD-008.

**Prompt:**

> Establish the production repository foundation and machine-enforced anti-drift boundary. Create the Node 20 TypeScript workspace, build/test/lint/typecheck commands, exact lockfile pins, dependency integrity checks, package-boundary rules, and `config/upstream-authorities.yaml`. Pin Ruflo, MetaHarness, `@metaharness/darwin`, `@metaharness/flywheel`, RedBlue, turn-credit, router, harness hosts, and `ruvector` to the baselines or newer explicitly verified exact versions. Implement capability/version probes and contract-test harnesses for every upstream authority. Add CI checks that reject floating versions, direct domain imports, unrecorded upstream exports, algorithm duplication, absent required production capabilities, unsigned artifacts, and files over 500 lines. Generate SBOM and conformance-report artifacts. Do not add business behavior yet.

**Exit gate:** clean checkout installs from the lockfile, builds, passes upstream compatibility fixtures and negative anti-drift tests, and emits dependency/SBOM/conformance evidence.

## Prompt 02 — Implement the shared kernel and DDD boundaries

**Prerequisites:** Prompt 01.

**Governing records:** ADR-002, ADR-009; DDD-001, DDD-008.

**Prompt:**

> Implement the minimal shared kernel: tenant/repository/aggregate IDs, UUIDv7, canonical digest references, UTC time, money, source snapshots, trust states, correlation/causation/idempotency IDs, and `agentics.evolution-envelope/v1`. Create bounded-context package boundaries exactly as DDD-001 specifies and public ports for every ACL in DDD-008. Domain exports must exclude infrastructure. Implement trust-transition guards for `IMAGINED → PRODUCED → PROVED → AUTHORIZED`, immutable past-tense domain events, schema registration, compatibility tests, property tests, and a Ruflo DDD boundary validator. Do not implement upstream algorithms inside ports.

**Exit gate:** forbidden imports fail CI; schema round trips, event replay, transition property tests, cross-tenant identifier tests, and unknown-version failure tests pass.

## Prompt 03 — Build transactional persistence and durable messaging

**Prerequisites:** Prompts 01–02.

**Governing records:** ADR-011, ADR-013; DDD-001, DDD-007.

**Prompt:**

> Implement PostgreSQL 16 aggregate persistence, append-only events, versions, tenant constraints/RLS, command idempotency, transactional outbox/inbox, and migration tooling. Implement the Pub/Sub transport adapter with ordering keys, bounded retry, dead-letter metadata, trace propagation, replay isolation, and payload-size enforcement. Provide a local production-parity transport for tests without changing semantics. Use serializable transactions with bounded retry for alpha spend, authorization consumption, budgets, and champion changes. Add migration interruption/mixed-version tests and duplicate/delayed/reordered/poison-message tests.

**Exit gate:** crash-at-boundary tests prove committed state eventually publishes one logical event; redelivery is harmless; migrations and critical concurrency tests pass.

## Prompt 04 — Implement artifact lineage, RVF binding, and signing

**Prerequisites:** Prompts 01–03.

**Governing records:** ADR-007, ADR-014, ADR-019; DDD-010.

**Prompt:**

> Implement the Artifact Lineage bounded context and a content-addressed storage port with local and GCS adapters. Support staged writes, canonical SHA-256 identity, immutable finalization, ordered dependency manifests, retention/legal holds, reachability-based garbage collection, classification, and signed references. Preserve MetaHarness/Flywheel canonicalization and implement its Signer port with a local development key and a Cloud KMS/HSM production adapter. Bind RVF cognitive-container witnesses to Agentics manifests without inventing another RVF format. Build the offline verifier package and key-manifest rotation/revocation workflow.

**Exit gate:** clean-machine offline verification, Flywheel signing fixtures, RVF import/export, tamper matrix, key rotation, partial upload, and garbage-collection concurrency tests pass.

## Prompt 05 — Implement policy, budgets, privacy, and tenant isolation

**Prerequisites:** Prompts 02–04.

**Governing records:** ADR-006, ADR-010, ADR-020; DDD-006.

**Prompt:**

> Implement the Governance context around existing Agentics policy-engine, enforcement, and usage-ledger. Add the named capabilities from ADR-006, shrinking-envelope algebra, separation of duties, short-lived bounded approvals, revocation, replay limits, atomic budget reservations/reconciliation, and fail-closed dependency behavior. Implement OIDC/service identity verification and the authorization middleware contract, but not the full API resources yet. Add classification, retention, deletion/tombstone, data residency, provider restrictions, and tenant isolation policies across database, artifact, event, cache, vector/Brain namespace, log, metric, and key lookup boundaries.

**Exit gate:** policy truth tables, subset property tests, self-approval/replay/expiry/revocation tests, concurrent budget tests, cross-tenant suite, retention simulation, and audited deletion receipt tests pass.

## Prompt 06 — Deploy the private RuVector Brain development substrate

**Prerequisites:** Prompts 01–05.

**Governing records:** ADR-025, ADR-007, ADR-020; DDD-008, DDD-012.

**Prompt:**

> Implement the Brain Knowledge context and `BrainKnowledgePort` using real pinned RuVector `mcp-brain-server-local` plus a compatible real embedder for development/integration tests. Implement capability negotiation and ACL mappings for share, search, get, list, vote, drift, partition, transfer, status, RVF provenance, and enabled cognitive/working-memory endpoints. Enforce tenant/repository/domain namespaces, trust/quality/expiry/supersession filters, embedding model/dimension pinning, Brain admission scans, and canonical CAS/RVF references. Implement deterministic reindex from canonical PostgreSQL/CAS/RVF evidence. Create private/local/public-π trust lanes; public π calls remain disabled by default.

**Exit gate:** real-service protocol tests—not mocks—pass for all required capabilities; namespace isolation, poisoning/outlier, PII/injection, dimension mismatch, drift, transfer, outage, and reindex tests pass.

## Prompt 07 — Implement governed π Brain federation

**Prerequisites:** Prompt 06.

**Governing records:** ADR-006, ADR-020, ADR-025; DDD-006, DDD-012.

**Prompt:**

> Implement the optional `pi.ruv.io` federation adapter through the official RuVector Brain client/API. Pulls must enter as `EXTERNAL_UNTRUSTED` observations with provenance and scans. Exports require a distinct authorization, single-use nonce, irreversible tenant/proprietary identifier removal, PII/secret/AIDefence checks, differential-privacy policy, RVF sealing, and a manifest proving that raw code, trajectories, holdouts, and tenant identifiers were excluded. Brain votes, public reputation, propositions, optimizer output, LoRA weights, and transfer priors must remain evidence inputs and cannot change Agentics trust state.

**Exit gate:** disabled-by-default, authorization, redaction, nonce replay, public outage, malicious-memory import, and prohibited-export tests pass; no private fixture reaches the public endpoint.

## Prompt 08 — Implement repository connection and enrollment

**Prerequisites:** Prompts 02–06.

**Governing records:** ADR-010, ADR-012, ADR-015; DDD-007, DDD-009.

**Prompt:**

> Implement Repository Integration and enrollment using agentics-org-manifests and a least-privilege GitHub App. Add installation/repository identity, permission verification, manifest validation, source snapshot capture, connection lifecycle, webhook signature/idempotency handling, rate-limit states, transfer/revocation handling, and single-writer worktree registry with fencing. Implement read-only enrollment first and `NONE|ISSUE|DRAFT_PR` write modes as policy-controlled settings; never implement merge, branch-protection administration, release, or secret management. Add repository-local mutation-contract and anchor-manifest validation.

**Exit gate:** permission, forged/replayed webhook, revoked/transferred repository, force-push, dirty worktree, fencing, rate-limit, and no-merge tests pass against a GitHub integration fixture.

## Prompt 09 — Implement the control API

**Prerequisites:** Prompts 03, 05, and 08.

**Governing records:** ADR-002, ADR-006, ADR-010; all DDD public application ports.

**Prompt:**

> Implement the OpenAPI 3.1 `/v1` control/read API for enrollments, cycles, evidence, hypotheses, campaigns, candidates, corpora, evaluations, authorizations, rollouts, receipts, Brain status, and offline-verification material. Each mutating operation maps to one application command and named policy action, requires idempotency, uses ETags where specified, and returns RFC 9457 problem details. Add cursor pagination, correlation IDs, tenant-safe not-found behavior, request limits, readiness/liveness, and degraded read-only mode. Generate clients from canonical schemas; do not hand-copy contract types.

**Exit gate:** OpenAPI compatibility/lint, generated-client, auth, idempotency conflict, enumeration, fuzz, size-limit, and degraded-mode tests pass.

## Prompt 10 — Implement durable scheduling and Ruflo orchestration

**Prerequisites:** Prompts 03, 05, 08, and 09.

**Governing records:** ADR-003, ADR-008, ADR-012; DDD-003, DDD-007, DDD-008.

**Prompt:**

> Implement the durable scheduler, schedule windows, PostgreSQL leases/fencing tokens, bounded catch-up, persistent cancellation, backpressure, and work-item lifecycle. Integrate Ruflo workers, hooks, trajectories, routing, ReasoningBank, and NightlyLearner through `RufloCoordinationPort`; Ruflo performs coordination and learning but PostgreSQL remains schedule authority. Propagate deadlines, capability references, budget references, trace context, and cancellation to every descendant. Implement no-overlap per repository and checkpoint-aware restart.

**Exit gate:** concurrent scheduler, stale fence, restart, DST/leap-day/clock-skew, missed-window, cancellation, backpressure, Ruflo failure, and duplicate-trigger tests pass.

## Prompt 11 — Implement evidence observation and admission

**Prerequisites:** Prompts 04–06, 08, and 10.

**Governing records:** ADR-002, ADR-003, ADR-007, ADR-020, ADR-025; DDD-002, DDD-010, DDD-012.

**Prompt:**

> Implement the Observation context and adapters for Git/CI, Ruflo trajectories/verdicts, human corrections, incidents, usage, repository changes, and research-core. Normalize into immutable observations; perform schema/size/encoding checks, secret/PII removal, AIDefence/tool-output/memory-poisoning scans, provenance verification, exact then Brain semantic deduplication, contrary-evidence preservation, CAS/RVF sealing, and private Brain projection. Implement quarantine, supersession, expiry, deterministic batch manifests, outbox events, and projection retry/rebuild.

**Exit gate:** deterministic fixture sealing, adapter contracts, duplicate/contradiction, prompt-injection, secret/PII, malformed input, decompression bomb, Brain outage, and projection rebuild tests pass.

## Prompt 12 — Implement the model gateway and measured routing

**Prerequisites:** Prompts 05–06 and 10.

**Governing records:** ADR-001, ADR-009, ADR-017; DDD-003, DDD-004, DDD-008.

**Prompt:**

> Implement the provider gateway and exact ACL around Ruflo routing/trajectory hooks plus `@metaharness/router`. Support task class, criticality, classification, quality bar, spend/token/time limit, allowed models/providers, data residency, and fallback policy. Route to the cheapest predicted model that clears quality; frontier escalation requires explicit capability and regret/budget gate. Keep credentials only in the gateway. Persist route/model/prompt/tool-schema/config/input/output digests, cost/latency/tokens/cache/safety outcomes and reconcile usage. Feed routing learning only from Flywheel-verified outcomes and turn-credit receipts; exclude holdouts.

**Exit gate:** deterministic catalog fixtures, budget/residency/model policy, transient retry, no-side-effect duplication, provider outage/fallback, credential leakage, and usage reconciliation tests pass.

## Prompt 13 — Implement the Dream Cycle

**Prerequisites:** Prompts 07 and 10–12.

**Governing records:** ADR-003, ADR-017, ADR-025; DDD-003, DDD-012.

**Prompt:**

> Implement the full Dream Cycle state machine. Freeze snapshot/evidence/config/budget; use private Brain search, partition, topology, drift, and governed transfer priors for clustering and novelty; rotate deep/scan surfaces; select one exemplar per failure class; synthesize sourced external research as untrusted data; detect duplicates/contradictions/exhaustion; and emit falsifiable hypotheses with metric, mutation surface, verifier, cost, confidence, and witness manifest. Incomplete cycles publish explicit reports and enqueue nothing. Dream has no repository-write, candidate, proof, or promotion capability.

**Exit gate:** golden historical replay produces the same digest; live staging fixture produces sourced hypotheses; rotation/drift, clustering, citation, injection, budget, cancellation, duplicate, contradiction, and capability-denial tests pass.

## Prompt 14 — Implement the untrusted execution substrate

**Prerequisites:** Prompts 04–05 and infrastructure definitions from Prompt 01.

**Governing records:** ADR-004, ADR-016, ADR-021; DDD-004.

**Prompt:**

> Implement the candidate/evaluator execution port with a production GKE Autopilot + GKE Sandbox/gVisor adapter and a semantically equivalent local test adapter. Enforce ephemeral jobs, non-root/read-only root, dropped capabilities, no host paths/socket/token/metadata, bounded writable overlay, quotas/deadline/PIDs, deny-by-default network, approved egress proxy, signed image admission, per-run identity, cancellation, trace sealing, and reconciliation cleanup. Keep model/signing calls outside the sandbox. Compose—not replace—Darwin `inspectVariant` and `validateGeneratedCode` as pre-admission gates.

**Exit gate:** escape, metadata, secret, network/DNS rebinding, symlink, fork bomb, disk fill, timeout, cancellation, cross-tenant, unapproved-image, controller-crash, and cluster-outage tests pass.

## Prompt 15 — Implement bounded Darwin evolution

**Prerequisites:** Prompts 12–14.

**Governing records:** ADR-004, ADR-009, ADR-016; DDD-004, DDD-008.

**Prompt:**

> Implement `EvolutionCampaign` and the Ruflo ADR-322B-style proposer adapter around `@metaharness/darwin`. Load a repository's approved mutation contract; create the baseline; evolve only Darwin's allowlisted surfaces; preserve immutable rails; record parent, seed, proposer/model/prompt, tools, runtime image, source snapshot, cost, safety and artifact digests; persist the complete Darwin archive including rejected branches; and support checkpoint/resume, bounded fanout, cancellation, and budget exhaustion. Do not rescore candidates or copy Darwin search/safety algorithms.

**Exit gate:** deterministic-seed archive, single-surface mutation, protected-path/shell/network/secret rejection, crash/resume, concurrency/budget, parent lineage, and no-self-scoring tests pass with the real Darwin package.

## Prompt 16 — Implement sealed evaluation corpora

**Prerequisites:** Prompts 04–05, 08, and 14.

**Governing records:** ADR-005, ADR-018; DDD-005, DDD-011.

**Prompt:**

> Implement the Evaluation Corpus context and test-bench adapters for TRAIN, ANCHOR, HOLDOUT, ADVERSARIAL, and CANARY suites. Add provenance/license/labels, expected-result commitments, semantic dedupe, deterministic secret-key split, encryption, evaluator-only access, hash-pinned manifests, power/representativeness reports, contamination scans, versioning, replacement, retirement, and evidence-reset linkage. Ensure Dream/Darwin/Brain retrieval/model prompts/logs cannot access holdout answers. Integrate project-local anchor rules from Ruflo ADR-331 and RedBlue adversarial suites.

**Exit gate:** secrecy, access audit, exact/semantic cross-split dedupe, contamination, digest mutation, power, replacement/reset, and historical replay tests pass.

## Prompt 17 — Implement Flywheel evaluation and sequential proof

**Prerequisites:** Prompts 04–05 and 14–16.

**Governing records:** ADR-005, ADR-018, ADR-019; DDD-005, DDD-010, DDD-011.

**Prompt:**

> Implement `EvaluationLineage` using `@metaharness/flywheel` as the exclusive gate, receipt, lineage, replay, and lift-curve engine. Map test-bench/RedBlue/cost/latency results to upstream Score without altering the gate. Enforce project anchor, sealed holdout, no regressions, safety/policy/cost/latency, gate fingerprint, signed receipt, informative-pair preflight, and Ruflo ADR-381 sequential alpha stream/evidence epochs. Implement governed reset, receipt expiry, version-compatible replay, complete rejected-attempt lineage, and `PROVED` qualification only. Evaluation must not authorize or serve.

**Exit gate:** controlled qualify/reject fixtures, independent replay, full tamper matrix, null simulations, preflight-without-alpha-spend, reset/fresh-data, historical schema, concurrency, and no-authorization tests pass.

## Prompt 18 — Implement authorization, rollout, and GitHub proposals

**Prerequisites:** Prompts 05, 08–09, and 17.

**Governing records:** ADR-002, ADR-005, ADR-006, ADR-015; DDD-006, DDD-007, DDD-009.

**Prompt:**

> Implement promotion authorization consumption and `Rollout` from `PROVED` through shadow, canary, and production. Bind candidate, receipt, source, environment, expected champion, envelope and policy epoch. Use one serializable transaction for authorization consumption, champion compare-and-swap, lineage reference, and outbox. Define minimum observations, drift/safety/cost limits, deadlines, automatic rollback to a verified champion, and incident events. Implement optional GitHub issue/draft-PR publishing with evidence and rollback instructions; never merge or release. Revalidate source/head before publishing.

**Exit gate:** unauthorized/stale/replayed/revoked approval, concurrent promotion, crash boundary, insufficient canary, injected regression, automatic rollback, force-push, draft-PR, and no-merge tests pass.

## Prompt 19 — Implement observability and operational reconciliation

**Prerequisites:** Prompts 03–18.

**Governing records:** ADR-008, ADR-022; DDD-007.

**Prompt:**

> Instrument every service and context using OpenTelemetry and the observatory adapter. Implement the mandatory business/safety/evidence/cost/statistical/infrastructure metrics from ADR-022, tail sampling, tenant-safe structured logs, durable audit buffering, SLO calculations, burn-rate and immediate-integrity alerts, dashboards, runbook links, incident-manager integration, and reconciliation jobs for outbox, inbox, CAS, Brain projections, leases, orphan jobs, approvals, budgets and champion lineage. Feed verified incident corrections back to Observation without bypassing gates.

**Exit gate:** synthetic signals trigger correct alerts/runbooks; an E2E trace spans API through rollout; cardinality/secret tests, SLO fixture calculations, telemetry outage, and every reconciler fault-injection test pass.

## Prompt 20 — Implement GCP infrastructure and secure delivery

**Prerequisites:** Prompts 01–19.

**Governing records:** ADR-008, ADR-016, ADR-021, ADR-023; DDD-007, DDD-008.

**Prompt:**

> Implement Terraform for isolated dev/staging/production GCP projects: private Cloud Run API/scheduler/relays, GKE Autopilot Sandbox workers, HA Cloud SQL PostgreSQL 16, Pub/Sub/DLQ, GCS/CMEK/versioning/retention, KMS, Secret Manager, VPC/private access, controlled GitHub webhook ingress, workload identities, monitoring and scheduler. Build hermetic CI/CD with migrations as a release job, SBOM, SLSA provenance, vulnerability/license checks, signed images, admission policy, clean source receipts, staging soak, canary and rollback. Production apply/publish remains a separately authorized action.

**Exit gate:** policy-tested Terraform plan, clean-environment staging apply, private-network tests, signed-image admission, migration, autoscaling/quota/provider-failure, and rollback rehearsal pass. Do not deploy production without explicit user authorization.

## Prompt 21 — Implement recovery and prove production readiness

**Prerequisites:** Prompts 01–20.

**Governing records:** ADR-007, ADR-008, ADR-020, ADR-024; DDD-007, DDD-010, DDD-012; `implementation-plan.md` system definition of done.

**Prompt:**

> Implement backups, cross-region artifact replication, database recovery, key/release-manifest replication, queue reconstruction, read-only recovery mode, recovery reconciliation, explicit write-enable authorization, and tested runbooks. Then execute the complete production-like acceptance journey: enroll a repository; capture and RVF-seal evidence into private Brain; Dream a sourced hypothesis; generate isolated Darwin candidates; evaluate with anchor/holdout/RedBlue; issue and independently replay a Flywheel receipt; obtain separate authorization; shadow/canary/promote; trigger and verify rollback; destroy and reconstruct transactional state, artifacts, lineage and Brain projection from recovery assets. Run load, chaos, penetration, cross-tenant, provider-outage, key-rotation, migration and supply-chain suites.

**Exit gate:** every ADR acceptance criterion has linked passing evidence; all DDD invariants have executable coverage; declared SLO/capacity and RPO/RTO are met; no placeholder, mock-default, fabricated telemetry, unauthorized promotion, cross-tenant disclosure, or unreplayable champion remains. Anything less is incomplete and must not be called production ready.

## Execution dependency summary

```text
01 Foundation
  → 02 Shared kernel
    → 03 Persistence/events
      → 04 Artifacts/signing
        → 05 Governance/privacy
          → 06 Private Brain → 07 π federation
          → 08 Repository enrollment → 09 API → 10 Scheduler
          → 12 Model gateway
        → 11 Observation
          → 13 Dream
        → 14 Sandbox → 15 Darwin
        → 16 Corpora
          → 17 Flywheel proof
            → 18 Authorization/rollout
              → 19 Operations
                → 20 GCP delivery
                  → 21 Recovery and final acceptance
```
