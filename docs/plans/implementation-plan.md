# Production implementation plan

## Delivery rule

No phase is complete because files, interfaces, or endpoints exist. A phase completes only when its vertical behavior runs in production-like infrastructure, its failure paths are tested, its evidence is replayable, and its runbook has been exercised.

## Target modules

```text
src/
  shared-kernel/
  observation/{domain,application,infrastructure}/
  dream/{domain,application,infrastructure}/
  evolution/{domain,application,infrastructure}/
  evaluation/{domain,application,infrastructure}/
  governance/{domain,application,infrastructure}/
  operations/{domain,application,infrastructure}/
  brain-knowledge/{domain,application,infrastructure}/
  repository-integration/{domain,application,infrastructure}/
  artifact-lineage/{domain,application,infrastructure}/
  evaluation-corpus/{domain,application,infrastructure}/
  api/
  workers/
```

Each context exports domain and application APIs only. Infrastructure adapters are composed at the process entrypoints.

## Slice 0: Reproducible foundation

Deliver:

- TypeScript/Node 20 service, exact dependency pins, lockfile, SBOM and signed container.
- Versioned schemas for envelopes and all aggregate IDs/digests.
- PostgreSQL migrations, outbox/inbox, CAS adapter, queue adapter, KMS signer, OpenTelemetry.
- Upstream contract tests for Ruflo, MetaHarness, Darwin, Flywheel, RedBlue, turn-credit, router, hosts, RuVector Brain, RVF and SONA.
- Local production-parity stack and CI gates.

Exit evidence: clean checkout builds offline from lockfile, verifies dependency integrity, migrates up/down, starts all roles, signs/verifies a fixture receipt, and passes absent/invalid dependency failure tests.

## Slice 1: Enroll and observe one repository

Deliver:

- Operations enrollment and scheduler lease.
- Private RuVector Brain plus compatible embedder, tenant namespace policy, RVF export/import, and real protocol tests.
- Observation adapters for Git/CI, Ruflo trajectories, usage, incidents, corrections and research.
- Redaction, Brain/AIDefence admission, provenance, CAS/RVF, Brain projection and deterministic batch sealing.
- Status/read APIs and operator dashboard.

Exit evidence: one enrolled repository produces a sealed, replayable evidence batch on schedule and retrieves it through private Brain; duplicate delivery, secret fixtures, injection, worker death and Brain outage pass.

## Slice 2: Produce a real Dream report

Deliver:

- Surface rotation, Brain drift/partition/transfer analysis, clustering, research synthesis, novelty and contradiction checks.
- Budget reservation, cancellation, witness manifest and incomplete-cycle behavior.
- `HypothesisProposed` published through the outbox.

Exit evidence: a fixed historical dataset reproduces the report digest; a live staging run produces sourced hypotheses; no Dream identity can mutate or write repositories.

## Slice 3: Generate bounded Darwin candidates

Deliver:

- Mutation contracts and immutable rails.
- Ruflo ADR-322B-compatible proposer adapter to `@metaharness/darwin`.
- Ephemeral worktree/container isolation, capability scrubbing, quotas, checkpoint/resume and complete archive persistence.

Exit evidence: a hypothesis creates baseline plus multiple candidates; valid candidates execute; escape/protected-path fixtures fail pre-evaluation; crash and budget exhaustion resume without corruption.

## Slice 4: Prove improvement with Flywheel

Deliver:

- Project anchor enrollment, sealed holdout, test-bench and RedBlue evaluators.
- Flywheel score adapter, frozen gate, receipt signing, replay bundle and lineage projection.
- Sequential alpha ledger, preflight power check and governed evidence reset.

Exit evidence: at least one candidate is correctly rejected and one controlled fixture qualifies; independent clean-machine replay agrees; tampering and null simulations pass; qualification grants no deployment access.

## Slice 5: Authorize and roll out

Deliver:

- Policy capabilities, shrinking envelope, human approval, budget reconciliation and authorization consumption.
- Atomic champion CAS/outbox, shadow and canary evaluation, automated rollback and incident generation.
- GitHub draft-PR adapter as an optional rollout target; merging remains independently authorized.

Exit evidence: staging progresses a qualified candidate through shadow/canary; unauthorized, stale, replayed and concurrent requests fail; injected canary regression rolls back automatically.

## Slice 6: Production hardening

Deliver:

- Multi-tenant isolation, KMS rotation, retention, PITR, replicated CAS, reconciler, rate/backpressure controls.
- Load, chaos, penetration, supply-chain, migration and disaster-recovery suites.
- SLOs, alerts, dashboards and tested runbooks.

Exit evidence: restore meets RPO/RTO; declared capacity meets SLO; cross-tenant suite has zero leaks; provider outages preserve read-only verification and prevent unsafe state changes.

## Release gates

Every production release requires:

1. accepted ADRs affected by the change and passing DDD boundary validation;
2. clean source snapshot and signed build provenance;
3. unit, property, contract, integration, E2E, replay, RedBlue, load and migration evidence;
4. no critical/high exploitable findings and documented lower-risk disposition;
5. staging soak and canary success;
6. separately authorized release capability;
7. rollback artifact and verified prior champion.

## Traceability matrix

| Production capability | Decision | Domain | Primary evidence |
|---|---|---|---|
| Upstream reuse | ADR-001 | all ACLs | compatibility matrix |
| Trust transitions | ADR-002 | DDD-001 | state/property tests |
| Nightly learning/research | ADR-003 | DDD-002/003 | deterministic cycle replay |
| Safe mutation | ADR-004 | DDD-004 | sandbox penetration + resume |
| Statistical qualification | ADR-005 | DDD-005 | receipt replay + null simulation |
| Authority/isolation | ADR-006 | DDD-006 | policy/cross-tenant suite |
| Durable evidence | ADR-007 | DDD-002/005/007 | restore + hash verification |
| Operable runtime | ADR-008 | DDD-007 | E2E, load, chaos, runbooks |
| Anti-drift ownership | ADR-009 | DDD-008 | generated authority/conformance report |
| API and workload identity | ADR-010 | DDD-006/007 | OpenAPI compatibility, auth and idempotency |
| Durable event delivery | ADR-011 | DDD-001/007 | duplicate/reorder/outbox/dead-letter suite |
| Scheduling and fencing | ADR-012 | DDD-007 | overlap, stale-token and cancellation suite |
| Transactional state | ADR-013 | all aggregates | concurrency, migration and PITR suite |
| Content-addressed storage | ADR-014 | DDD-010 | digest, retention and reachability suite |
| Repository delivery | ADR-015 | DDD-009 | GitHub App/no-merge suite |
| Untrusted execution | ADR-016 | DDD-004 | gVisor escape, quota and egress suite |
| Model routing/execution | ADR-017 | DDD-003/004 | routing, budget and provider-failure suite |
| Artifact/RVF lineage | ADR-014/019 | DDD-010 | offline CAS/RVF verification |
| Evaluation truth | ADR-018 | DDD-011 | secrecy/contamination/power suite |
| Privacy and retention | ADR-020 | DDD-002/010/012 | isolation, purge and retention suite |
| GCP production topology | ADR-021 | DDD-007 | Terraform, network and failover suite |
| SLOs and incidents | ADR-022 | DDD-007 | synthetic alerts, traces and runbooks |
| Supply-chain/release | ADR-023 | DDD-008/010 | clean-room provenance and admission |
| Business continuity | ADR-024 | DDD-007/010/012 | regional recovery game day |
| Cognitive intelligence | ADR-025 | DDD-012 | real Brain protocol, isolation and reindex |

## System definition of done

The system is production ready only when a newly enrolled repository can, without manual database edits:

1. capture and RVF-seal real evidence into the private RuVector Brain and canonical stores;
2. run a scheduled Dream Cycle;
3. produce a sourced hypothesis;
4. generate safely isolated Darwin candidates;
5. evaluate them against project-local anchor, sealed holdout and adversarial suites;
6. issue and independently replay a Flywheel receipt;
7. obtain separate policy authorization;
8. shadow and canary the candidate;
9. promote atomically or roll back automatically;
10. reconstruct the complete chain and private Brain projection after disaster recovery.

Anything less is an incomplete implementation, regardless of API or scaffold coverage.
