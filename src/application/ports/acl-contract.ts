export type ReadValue<T> =
  | { readonly kind: "KNOWN"; readonly value: T }
  | { readonly kind: "UNRECOGNIZED"; readonly rawValue: string };

export interface UpstreamCallContext {
  readonly tenantId: TenantId;
  readonly repositoryId: RepositoryId;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly deadline: UtcInstant;
  readonly signal: AbortSignal;
}

export interface UpstreamEvidence {
  readonly authority: string;
  readonly exactVersion: string;
  readonly capabilityDigest: `sha256:${Sha256Digest}`;
  readonly correlationId: CorrelationId;
}

export type ArtifactReference = DigestReference;

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
  tenantId(context.tenantId); repositoryId(context.repositoryId); correlationId(context.correlationId);
  if (context.causationId) causationId(context.causationId);
  const deadline = Date.parse(utcInstant(context.deadline));
  if (deadline <= Date.now()) throw new TypeError("deadline must be in the future");
  if (context.signal.aborted) throw context.signal.reason ?? new DOMException("cancelled", "AbortError");
}

export interface ExpectedUpstreamEvidence { readonly correlationId: CorrelationId; readonly authority: string; readonly exactVersion: string; readonly capabilityDigest: `sha256:${Sha256Digest}`; }
export function validateUpstreamEvidence(evidence: UpstreamEvidence, expected: ExpectedUpstreamEvidence): void {
  if (evidence.correlationId !== expected.correlationId) throw new Error("INCOMPATIBLE: upstream correlation mismatch");
  if (evidence.authority !== expected.authority) throw new Error("INCOMPATIBLE: upstream authority mismatch");
  if (evidence.exactVersion !== expected.exactVersion) throw new Error("INCOMPATIBLE: upstream version mismatch");
  if (evidence.capabilityDigest !== expected.capabilityDigest) throw new Error("INCOMPATIBLE: upstream capability digest mismatch");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(evidence.exactVersion))
    throw new Error("INCOMPATIBLE: upstream version is not exact");
  if (!/^sha256:[a-f0-9]{64}$/.test(evidence.capabilityDigest))
    throw new Error("INCOMPATIBLE: invalid capability digest");
}

export function validatedPortResponse<T>(data: T, upstream: UpstreamEvidence, expected: ExpectedUpstreamEvidence): Readonly<PortResponse<T>> {
  validateUpstreamEvidence(upstream, expected);
  return Object.freeze({ data, upstream: Object.freeze({ ...upstream }) });
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
import type { DigestReference, Sha256Digest } from "../../shared-kernel/digest.js";
import { repositoryId, tenantId } from "../../shared-kernel/identity.js";
import type { RepositoryId, TenantId } from "../../shared-kernel/identity.js";
import { utcInstant } from "../../shared-kernel/time.js";
import type { UtcInstant } from "../../shared-kernel/time.js";
import { causationId, correlationId } from "../../shared-kernel/uuid-v7.js";
import type { CausationId, CorrelationId } from "../../shared-kernel/uuid-v7.js";
