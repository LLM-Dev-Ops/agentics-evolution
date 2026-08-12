import { AggregateIdentity, sameScope } from "../shared-kernel/identity.js";
import { Sha256Digest } from "../shared-kernel/digest.js";
import { EvolutionEnvelope, envelopeDigest } from "../shared-kernel/evolution-envelope.js";
import { TrustCommand, TrustState, TransitionEvidence, transitionTrust } from "../shared-kernel/trust-state.js";

export interface TrustAggregate extends AggregateIdentity {
  readonly state: TrustState | null;
  readonly version: number;
  readonly historyDigest: Sha256Digest | null;
  readonly handledKeys: ReadonlySet<string>;
  readonly revoked: boolean;
}

export const emptyTrustAggregate = (identity: AggregateIdentity): TrustAggregate => Object.freeze({ ...identity, state: null, version: 0, historyDigest: null, handledKeys: new Set<string>(), revoked: false });

export function applyTrustEvent(state: TrustAggregate, event: EvolutionEnvelope): TrustAggregate {
  if (!sameScope(state, event) || state.aggregateId !== event.aggregateId) throw new TypeError("foreign aggregate event rejected");
  const scopedKey = `${event.tenantId}:${event.idempotencyKey}`;
  if (state.handledKeys.has(scopedKey)) return state;
  const command: Record<string, TrustCommand> = {
    HypothesisProposed: "ProposeHypothesis", CandidateGenerated: "GenerateCandidate",
    EvaluationAccepted: "AcceptEvaluation", PromotionAuthorized: "AuthorizePromotion"
  };
  let nextState = state.state;
  let revoked = state.revoked;
  const nextCommand = command[event.type];
  if (nextCommand) {
    const evidence: TransitionEvidence = nextCommand === "ProposeHypothesis" ? { sourceValidated: true }
      : nextCommand === "GenerateCandidate" ? { mutationAdmitted: true }
      : nextCommand === "AcceptEvaluation" ? { proofVerified: true } : { independentAuthorization: true };
    nextState = transitionTrust(state.state, nextCommand, evidence);
  } else if (event.type === "AuthorizationRevoked" && state.state === "AUTHORIZED") revoked = true;
  else throw new TypeError(`unknown or invalid trust event: ${event.type}`);
  return Object.freeze({ ...state, state: nextState, revoked, version: state.version + 1, historyDigest: envelopeDigest(event), handledKeys: new Set([...state.handledKeys, scopedKey]) });
}

export function replayTrust(identity: AggregateIdentity, events: readonly EvolutionEnvelope[]): TrustAggregate {
  let state = emptyTrustAggregate(identity);
  for (const event of events) state = applyTrustEvent(state, event);
  return state;
}
