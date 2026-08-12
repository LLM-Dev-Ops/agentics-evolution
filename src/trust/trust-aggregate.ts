import { AggregateIdentity, sameScope } from "../shared-kernel/identity.js";
import { DigestReference, Sha256Digest, digestBytes, verifyDigest } from "../shared-kernel/digest.js";
import { EvolutionEnvelope, envelopeDigest } from "../shared-kernel/evolution-envelope.js";
import { ServingAuthorization, TrustCommand, TrustState, TransitionEvidence, transitionTrust } from "../shared-kernel/trust-state.js";
import { canonicalJson } from "../shared-kernel/immutable.js";
import { EnvelopeSchemaRegistry } from "../shared-kernel/schema-registry.js";

export interface TrustAggregate extends AggregateIdentity {
  readonly state: TrustState | null;
  readonly version: number;
  readonly historyDigest: Sha256Digest | null;
  readonly handledKeys: Readonly<Record<string, Sha256Digest>>;
  readonly revoked: boolean;
}

export const emptyTrustAggregate = (identity: AggregateIdentity): TrustAggregate => Object.freeze({ ...identity, state: null, version: 0, historyDigest: null, handledKeys: Object.freeze({}), revoked: false });

export type DigestResolver = (reference: DigestReference) => Uint8Array;
export type TransitionEvidenceVerifier = (input: Readonly<{
  authority: "Dream" | "Darwin" | "Flywheel" | "Governance";
  event: EvolutionEnvelope;
  reference: DigestReference;
  bytes: Uint8Array;
}>) => boolean;
export function applyTrustEvent(state: TrustAggregate, event: EvolutionEnvelope, registry: EnvelopeSchemaRegistry,
  resolveEvidence: DigestResolver, verifyAuthority: TransitionEvidenceVerifier): TrustAggregate {
  registry.validate(event);
  if (!sameScope(state, event) || state.aggregateId !== event.aggregateId) throw new TypeError("foreign aggregate event rejected");
  const scopedKey = `${event.tenantId}:${event.idempotencyKey}`;
  const eventDigest = envelopeDigest(event);
  if (state.handledKeys[scopedKey]) {
    if (state.handledKeys[scopedKey] !== eventDigest) throw new TypeError("idempotency key reused for conflicting event");
    return state;
  }
  const command: Record<string, TrustCommand> = {
    HypothesisProposed: "ProposeHypothesis", CandidateGenerated: "GenerateCandidate",
    EvaluationAccepted: "AcceptEvaluation", PromotionAuthorized: "AuthorizePromotion"
  };
  let nextState = state.state;
  let revoked = state.revoked;
  const nextCommand = command[event.type];
  if (nextCommand) {
    if (event.evidence.length === 0) throw new TypeError("trust transition requires artifact evidence");
    const requiredAuthority = nextCommand === "ProposeHypothesis" ? "Dream" : nextCommand === "GenerateCandidate" ? "Darwin"
      : nextCommand === "AcceptEvaluation" ? "Flywheel" : "Governance";
    for (const reference of event.evidence) {
      const bytes = resolveEvidence(reference);
      verifyDigest(reference, bytes);
      if (!verifyAuthority({ authority: requiredAuthority, event, reference, bytes })) throw new TypeError(`${requiredAuthority} signed authority evidence rejected`);
    }
    const evidence: TransitionEvidence = nextCommand === "ProposeHypothesis" ? { sourceValidated: true }
      : nextCommand === "GenerateCandidate" ? { mutationAdmitted: true }
      : nextCommand === "AcceptEvaluation" ? { proofVerified: true } : { independentAuthorization: true };
    nextState = transitionTrust(state.state, nextCommand, evidence);
  } else if (event.type === "AuthorizationRevoked" && state.state === "AUTHORIZED") revoked = true;
  else throw new TypeError(`unknown or invalid trust event: ${event.type}`);
  const historyDigest = digestBytes(new TextEncoder().encode(canonicalJson({ previous: state.historyDigest, event: eventDigest, version: state.version + 1 })));
  return Object.freeze({ ...state, state: nextState, revoked, version: state.version + 1, historyDigest,
    handledKeys: Object.freeze({ ...state.handledKeys, [scopedKey]: eventDigest }) });
}

const authorizationBrand: unique symbol = Symbol("ServingAuthorization");
export function authorizeServing(aggregate: TrustAggregate): ServingAuthorization {
  if (aggregate.state !== "AUTHORIZED" || aggregate.revoked) throw new TypeError("active AUTHORIZED aggregate required for serving");
  return Object.freeze({ aggregateId: aggregate.aggregateId, [authorizationBrand]: true }) as unknown as ServingAuthorization;
}

export function replayTrust(identity: AggregateIdentity, events: readonly EvolutionEnvelope[], registry: EnvelopeSchemaRegistry,
  resolveEvidence: DigestResolver, verifyAuthority: TransitionEvidenceVerifier): TrustAggregate {
  let state = emptyTrustAggregate(identity);
  for (const event of events) state = applyTrustEvent(state, event, registry, resolveEvidence, verifyAuthority);
  return state;
}
