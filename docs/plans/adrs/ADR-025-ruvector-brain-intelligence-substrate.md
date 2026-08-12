# ADR-025: RuVector Brain as the intelligence substrate

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: ruvector, brain, rvf, sona, collective-intelligence

## Context

RuVector Brain already implements the memory and cognition capabilities Agentics Evolution needs: MCP/REST knowledge sharing and search, provenance and voting, RVF cognitive containers, SONA learning, graph/HNSW retrieval, MinCut partitioning, drift detection, domain transfer, neural-symbolic propositions, working memory, differential privacy, and Byzantine/reputation controls. Treating it as a generic vector index would discard working infrastructure and create drift.

The public `pi.ruv.io` service is a hosted collective plane accepting pseudonymous contributions. Enterprise Agentics evidence cannot be sent there by default.

## Decision

Make a private, tenant-isolated deployment of RuVector `mcp-brain-server` the canonical semantic intelligence plane. Use the pinned `ruvector` npm/MCP client or Rust `mcp-brain` client through a typed Brain ACL; do not implement local embedding, graph, voting, partitioning, drift, transfer, cognitive-container, or SONA substitutes.

### Owned capabilities

| Need | RuVector Brain authority |
|---|---|
| Semantic retrieval and shared memory | `brain_search`, `brain_get`, `brain_list`, `brain_share` |
| Quality and trust | `brain_vote`, provenance, reputation, Byzantine/outlier controls |
| Knowledge topology | `brain_partition`, GNN/HNSW, MinCut |
| Distribution change | `brain_drift`, VectorDelta/SNN anomaly detection |
| Cross-domain reuse | `brain_transfer` with dampened priors and holdout verification |
| Portable evidence | RVF cognitive containers, signatures, witness chains |
| Adaptive learning | SONA/MicroLoRA and Brain training loops |
| Structured reasoning | grounded propositions, Horn rules, `/v1/reason` |
| Working cognition | observation/hypothesis/reflection working-memory types |

### Trust lanes

1. **Private Brain**: canonical Agentics semantic plane; private networking, Agentics identity, tenant namespace/capability filters, CMEK persistence, backups, and no public federation.
2. **Local/offline Brain**: development and recovery using `mcp-brain-server-local` plus the compatible embedder; protocol-tested against production.
3. **Public π Brain**: opt-in external research exchange only. Pulls enter as `EXTERNAL_UNTRUSTED`; contributions must be explicitly authorized, distilled, PII/secret scanned, differentially private, RVF-sealed, and contain no proprietary code, raw trajectories, holdouts, or tenant identifiers.

### Integration rules

- Brain stores semantic/cognitive projections and RVF evidence; PostgreSQL remains transaction authority and GCS CAS remains bulk immutable artifact authority.
- Every Brain memory carries tenant, repository, trust state, source digest, evidence grade, expiry, supersession, and CAS reference. Retrieval requires namespace and minimum-quality/trust filters.
- Brain hypotheses/propositions are evidence inputs, never automatic Flywheel proof or policy authorization.
- Brain optimizer/SONA outputs enter Darwin as hypotheses or routing priors and must pass the same anchor/holdout/Flywheel gates.
- Capability negotiation (`brain_status`/health plus protocol contract) runs at startup. Missing mandatory private-Brain capability fails readiness; public π outage only disables federation.
- Exact RuVector source/package/container digest and embedding model/dimension are pinned. Mixed embedding dimensions in one index are forbidden.

## Acceptance criteria

1. Real-service protocol tests cover share, search, get, vote, list, drift, partition, transfer, status, RVF provenance, and enabled cognitive endpoints—no mocks.
2. Tenant namespace/capability tests prevent cross-tenant search, graph edges, votes, transfer, training, and LoRA sync.
3. Private data cannot reach `pi.ruv.io` without explicit export authorization and policy-compliant distillation.
4. Brain outage preserves canonical evidence and blocks semantic-dependent cycles without corrupting transactional state.
5. Reindex from PostgreSQL/CAS/RVF reconstructs identical memory IDs, provenance, and verified retrieval fixtures.
6. Poisoning, outlier, injection, PII, drift, replay-nonce, embedding-dimension, and stale-model tests pass.
7. A promoted Brain-derived improvement is still independently verified by Flywheel; Brain quality votes alone cannot promote it.

## Consequences

### Positive

- Agentics gains Ruvnet's existing cognitive graph, learning, security, transfer, and portable-memory stack.
- Private operational knowledge and optional public collective knowledge have explicit boundaries.

### Negative

- Operating the Rust Brain service and compatible embedder adds a production component and upgrade matrix.
- Some advanced Brain features are feature-gated; enrollment must declare required capabilities.

## Links

- RuVector ADR-059, ADR-060, ADR-064, ADR-066, ADR-083, ADR-095, ADR-110
- [π Shared Brain](https://pi.ruv.io/)
- [RuVector](https://github.com/ruvnet/ruvector)
- [DDD-012](../ddd/DDD-012-brain-knowledge-context.md)
