export type ReadValue<T> =
  | { readonly kind: "KNOWN"; readonly value: T }
  | { readonly kind: "UNRECOGNIZED"; readonly rawValue: string };

export interface UpstreamCallContext {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly deadline: string;
  readonly signal: AbortSignal;
}

export interface UpstreamEvidence {
  readonly authority: string;
  readonly exactVersion: string;
  readonly capabilityDigest: `sha256:${string}`;
  readonly correlationId: string;
}

export interface ArtifactReference {
  readonly uri: `cas://sha256/${string}`;
  readonly sha256: string;
}

export interface PortResponse<T> {
  readonly data: T;
  readonly upstream: UpstreamEvidence;
}

export type PortFailureCode = "CANCELLED" | "TIMEOUT" | "INCOMPATIBLE" | "UNAVAILABLE" | "FAILED";

export interface PortFailure {
  readonly code: PortFailureCode;
  readonly authority: string;
  readonly retryable: boolean;
  readonly message: string;
  readonly correlationId: string;
}

export const ACL_PORT_CONTRACTS = {
  HarnessAnalysisPort: { authority: "metaharness", methods: ["analyze"] },
  DarwinEvolutionPort: { authority: "darwin", methods: ["evolve", "inspectCandidate", "validateGeneratedCandidate"] },
  FlywheelProofPort: { authority: "flywheel", methods: ["evaluateGate", "verifyReceipt", "verifyReplay", "walkLineage"] },
  BrainKnowledgePort: { authority: "ruvector-brain-local", methods: ["share", "search", "get", "list", "vote", "drift", "partition", "transfer", "status"] },
  RufloCoordinationPort: { authority: "ruflo", methods: ["start", "dispatch", "cancel", "status", "trajectory", "route"] },
  RedBluePort: { authority: "redblue", methods: ["runBaseline", "retest", "buildReport"] }
} as const;

export function validateCallContext(context: UpstreamCallContext): void {
  for (const [field, value] of Object.entries({
    tenantId: context.tenantId,
    repositoryId: context.repositoryId,
    correlationId: context.correlationId,
    deadline: context.deadline
  })) if (value.trim().length === 0) throw new TypeError(`${field} must be non-empty`);
  const deadline = Date.parse(context.deadline);
  if (!Number.isFinite(deadline) || !context.deadline.endsWith("Z")) throw new TypeError("deadline must be an RFC3339 UTC instant");
  if (context.signal.aborted) throw context.signal.reason ?? new DOMException("cancelled", "AbortError");
}

export function validateUpstreamEvidence(evidence: UpstreamEvidence, expectedCorrelationId: string): void {
  if (evidence.correlationId !== expectedCorrelationId) throw new Error("INCOMPATIBLE: upstream correlation mismatch");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(evidence.exactVersion))
    throw new Error("INCOMPATIBLE: upstream version is not exact");
  if (!/^sha256:[a-f0-9]{64}$/.test(evidence.capabilityDigest))
    throw new Error("INCOMPATIBLE: invalid capability digest");
}

export function observeUnknown<T>(rawValue: string, known: Readonly<Record<string, T>>): ReadValue<T> {
  return Object.hasOwn(known, rawValue)
    ? { kind: "KNOWN", value: known[rawValue] as T }
    : { kind: "UNRECOGNIZED", rawValue };
}

export function requireKnown<T>(value: ReadValue<T>, field: string): T {
  if (value.kind === "UNRECOGNIZED") throw new Error(`INCOMPATIBLE: unrecognized ${field} '${value.rawValue}'`);
  return value.value;
}
