# DDD-012: Brain Knowledge context

- **Status**: proposed
- **Parent**: [DDD-001](DDD-001-context-map-and-ubiquitous-language.md)

## Responsibility

Govern how Agentics knowledge enters, evolves within, is retrieved from, and optionally federates through RuVector Brain without confusing cognitive confidence with deployment authority.

## Aggregate: `KnowledgeContribution`

States: `DRAFT → SCANNED → SEALED → SHARED → CANONICAL`, with `QUARANTINED|ARCHIVED|SUPERSEDED|DELETED`.

### Invariants

- Content has provenance, trust lane, tenant/repository namespace, evidence grade, source/CAS digest, expiry, classification, and RVF witness.
- PII, secrets, injection, invalid vectors, and disallowed magnitude/dimension fail before sharing.
- Public federation requires separate export authorization and irreversible removal of tenant/proprietary identifiers.
- Votes and Brain reputation affect retrieval rank, not Agentics trust-state transitions.
- Domain transfer creates a dampened prior that must pass target-domain holdout.
- Brain-generated propositions, hypotheses, reflections, optimizer output, and LoRA weights are untrusted inputs until Flywheel verification.

## Value objects

- `BrainNamespace(tenant,repository,domain)`
- `BrainMemoryRef(memoryId,rvfDigest,witness,quality,provenance)`
- `TrustLane(PRIVATE|LOCAL|PUBLIC_PI)`
- `TransferPrior(sourceDomain,targetDomain,damping,evidence)`
- `DriftReport(cluster,centroidDelta,anomalies,observedAt)`

## Commands

- `PrepareKnowledgeContribution`
- `SharePrivateMemory`
- `VoteOnMemory`
- `SearchKnowledge`
- `DetectKnowledgeDrift`
- `PartitionKnowledgeGraph`
- `ProposeDomainTransfer`
- `ExportToPublicBrain`
- `ImportFromPublicBrain`
- `SupersedeKnowledge`

## Events

- `KnowledgeContributionPrepared`, `PrivateMemoryShared`, `MemoryVoted`
- `KnowledgeDriftDetected`, `KnowledgeGraphPartitioned`
- `DomainTransferProposed`, `PublicKnowledgeExported`, `PublicKnowledgeImported`
- `KnowledgeSuperseded`, `KnowledgeQuarantined`

## Domain services

- `BrainACL`: real MCP/REST protocol adapter with capability negotiation.
- `KnowledgeAdmission`: AIDefence, PII, vector bounds, nonce, provenance and RVF validation.
- `FederationPolicy`: separates private/local/public lanes.
- `CognitiveEvidenceAdapter`: maps Brain propositions/reflections to Observation or Hypothesis, never proof.
- `BrainReindexer`: rebuilds private Brain projections from canonical evidence.

## Tests

Run against real local `mcp-brain-server-local` and compatible embedder. Cover protocol parity, namespaces, RVF/witness, voting, drift, partition, transfer, symbolic reasoning, working memory, poisoning/outliers, public export/import, reindex, and failure recovery.
