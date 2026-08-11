# Agentics Evolution: Dream Cycle, Darwin, and Flywheel

## Direction

We should not build an independent Dream Cycle engine from scratch. We should build an `agentics-dev` evolution control plane on top of Ruv's MetaHarness stack.

The responsibilities should be separated clearly:

```text
Dream Cycle
observes failures, drift, research, and opportunities
                  ↓
Darwin
generates bounded mutations to the agent harness
                  ↓
Flywheel
evaluates candidates and governs promotion
                  ↓
Signed lineage
records exactly what changed, why, and with what evidence
```

MetaHarness frames the harness, not the foundation model, as the evolving product. Its generated scaffolds include Darwin Mode, repository-specific memory, governance, skills, MCP tools, host adapters, provenance, and release gates.

Reference: [MetaHarness README](https://github.com/ruvnet/metaharness/blob/main/README.md)

## Recommended project

Create a dedicated repository:

```text
agentics-dev/agentics-evolution
```

This becomes the organization-level evolution control plane. Individual repositories remain the systems being observed and improved.

The repository should not be called only `dream-cycle`, because Dream Cycle is one stage. The complete system is:

- Dream Cycle: discovery and hypothesis formation
- Darwin: safe candidate mutation
- Flywheel: evaluation and promotion
- MetaHarness: repository-aware harness generation and runtime
- Ruflo: orchestration, workers, trajectories, and memory
- RuVector/AgentDB: long-term adaptive memory and retrieval

## How the nightly cycle should work

### 1. Observe

Collect:

- Agent trajectories
- Failed or low-confidence tasks
- Repeated tool errors
- Expensive model escalations
- Human corrections
- Test and CI failures
- Reverted changes
- Repository drift
- New papers and external developments

This produces an immutable observation bundle.

### 2. Dream

Cluster observations and generate hypotheses:

- This skill is missing an important instruction.
- This routing policy escalates too often.
- This agent needs a narrower tool boundary.
- This workflow repeatedly fails during verification.
- New research suggests a better memory strategy.

Dream output should be proposals, never trusted mutations.

### 3. Darwin mutation

Darwin turns selected hypotheses into bounded candidate changes:

- Agent role definitions
- Skills
- Structured policies
- Routing thresholds
- Tool permissions
- Retry budgets
- Context selection
- Verification strategies
- Swarm composition

It should not be permitted to mutate:

- Its safety envelope
- Promotion rules
- Holdout tests
- Scorers
- Protected governance files
- Credential policy
- Release authorization

Ruv's implementation treats safety rails as immutable and evaluates them before a candidate can enter benchmarking. That is the appropriate boundary for this project.

### 4. Flywheel evaluation

Each candidate runs against:

- Frozen anchor tests
- A genuinely held-out evaluation set
- Security and policy tests
- Cost and latency measurements
- Regression tests
- Replay of relevant historical trajectories
- An unchanged baseline harness

Flywheel then applies a conjunctive promotion gate. A candidate should improve the target metric without violating anchors, safety, cost ceilings, or regression limits.

MetaHarness's Flywheel is designed around:

```text
run → measure → mutate → verify → promote
```

It supplies candidate lineage, promotion receipts, replay bundles, signed evidence, and lift-curve analysis. It is deliberately model- and host-independent.

### 5. Promotion

Promotion should have levels:

```text
rejected
  → archived candidate
  → experimental
  → shadow
  → canary
  → recommended
  → human-approved production
```

At least initially, the system must not promote directly to production. Flywheel can determine that a candidate qualifies, but a separate organization policy should authorize deployment.

Ruflo's governance makes the same distinction: MetaHarness may evaluate candidates, but it may not expand its safety envelope or unilaterally grant itself release authority.

Reference: [Ruflo agent policy](https://github.com/ruvnet/ruflo/blob/main/AGENTS.md)

## Repository topology

The intended conceptual structure is:

```text
agentics-dev/agentics-evolution
├── harness/
│   ├── spec
│   ├── agents
│   ├── skills
│   ├── policies
│   └── host-adapters
├── dream/
│   ├── rotations
│   ├── prompts
│   ├── research-policy
│   └── clustering
├── darwin/
│   ├── mutation-surfaces
│   ├── immutable-rails
│   └── candidate-policy
├── flywheel/
│   ├── promotion-rules
│   ├── anchors
│   ├── holdouts
│   └── evaluators
├── adapters/
│   ├── github
│   ├── codex
│   ├── claude-code
│   └── ruflo
├── schemas/
│   ├── observation
│   ├── hypothesis
│   ├── candidate
│   └── promotion-receipt
└── org/
    └── repositories.yaml
```

This is the intended architecture, not the initial scaffold.

## The key feedback loop

The valuable loop is larger than nightly code generation:

```text
Production experience
      ↓
Dream identifies an improvement opportunity
      ↓
Darwin proposes several bounded alternatives
      ↓
Flywheel measures them against baseline and holdout
      ↓
Only verified improvements become candidates for promotion
      ↓
New production experience tests whether the improvement persists
      ↓
Accepted and rejected outcomes train the next cycle
```

Rejected mutations are useful evidence too. They tell Darwin which levers fail, overfit, cost too much, or damage anchors. MetaHarness Flywheel retains both promoted and rejected candidates so mutation effectiveness can be measured over generations.

## Important design principle

Dream Cycle should not be allowed to alter the system directly.

It should provide hypotheses to Darwin. Darwin should only mutate approved surfaces. Flywheel should be the sole technical promotion gate. Organization policy should remain the final deployment authority.

This gives `agentics-dev` compounding learning behavior while retaining a verifiable boundary between:

```text
something the system imagined
something Darwin produced
something Flywheel proved
something a human authorized
```

Before implementation, the first design deliverable should be an ADR defining those four trust states and the immutable safety boundary.
