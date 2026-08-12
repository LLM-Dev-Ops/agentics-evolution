import test from "node:test";
import assert from "node:assert/strict";
import {
  actorId, aggregateId, causationId, correlationId, createEnvelope, cycleId, digestBytes, digestReference,
  emptyTrustAggregate, encodeEnvelope, EnvelopeSchemaRegistry, eventId, idempotencyKey, money,
  moneyFromWire, moneyToWire, newCausationId, newCorrelationId, newEventId, newIdempotencyKey,
  replayTrust, repositoryId, servingAuthorization, sourceSnapshot, tenantId, transitionTrust, utcInstant
} from "../dist/index.js";

const identity = Object.freeze({ tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), aggregateId: aggregateId("aggregate-a") });
const evidenceBytes = new TextEncoder().encode("verified upstream evidence");
const evidenceSha = digestBytes(evidenceBytes);
const evidence = digestReference({ uri: `cas://sha256/${evidenceSha}`, sha256: evidenceSha });
const events = ["HypothesisProposed", "CandidateGenerated", "EvaluationAccepted", "PromotionAuthorized"];
const authorities = ["Dream", "Darwin", "Flywheel", "Governance"];
const resolveEvidence = () => evidenceBytes;
function envelope(type, index, overrides = {}) {
  return createEnvelope({ envelopeSchema: "agentics.evolution-envelope/v1", schemaVersion: 1,
    id: newEventId(), type, ...identity, cycleId: cycleId("cycle-a"), actorId: actorId("actor-a"),
    occurredAt: utcInstant(`2026-08-12T00:00:0${index}.000Z`), causationId: newCausationId(), correlationId: newCorrelationId(),
    idempotencyKey: newIdempotencyKey(), policyEpoch: 1, sourceRef: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }),
    evidence: [evidence], payload: { tenantId: identity.tenantId, repositoryId: identity.repositoryId, authority: authorities[index] ?? "Dream", step: index }, ...overrides });
}

test("UUIDv7 identifiers validate version, variant, uniqueness, and lexical time order", () => {
  const values = Array.from({ length: 10_000 }, newEventId);
  assert.equal(new Set(values).size, values.length);
  assert.deepEqual([...values].sort(), values);
  for (const value of values.slice(0, 100)) assert.equal(eventId(value), value);
  assert.throws(() => correlationId("00000000-0000-4000-8000-000000000000"), /UUIDv7/);
});

test("identity, digest, UTC, money, and snapshot parsers fail closed", () => {
  for (const invalid of ["", "UPPER", "a/b", "a\u0000b", "a".repeat(129)]) assert.throws(() => tenantId(invalid));
  assert.throws(() => digestReference({ uri: `cas://sha256/${"b".repeat(64)}`, sha256: "a".repeat(64) }), /disagree/);
  assert.throws(() => utcInstant("2026-08-12T00:00:00+00:00"));
  assert.deepEqual(moneyFromWire(moneyToWire(money(12345678901234567890n, "USD"))), money(12345678901234567890n, "USD"));
  assert.throws(() => money(-1n, "USD"));
  assert.throws(() => sourceSnapshot({ commit: "not-a-commit", dirtySnapshot: null }));
});

test("trust transition property exhaustively permits only the four evidenced edges", () => {
  const states = [null, "IMAGINED", "PRODUCED", "PROVED", "AUTHORIZED"];
  const commands = ["ProposeHypothesis", "GenerateCandidate", "AcceptEvaluation", "AuthorizePromotion"];
  const legal = new Set(["null:ProposeHypothesis", "IMAGINED:GenerateCandidate", "PRODUCED:AcceptEvaluation", "PROVED:AuthorizePromotion"]);
  for (let repeat = 0; repeat < 2_000; repeat++) for (const state of states) for (const command of commands) {
    const proof = { sourceValidated: true, mutationAdmitted: true, proofVerified: true, independentAuthorization: true };
    if (legal.has(`${state}:${command}`)) assert.doesNotThrow(() => transitionTrust(state, command, proof));
    else assert.throws(() => transitionTrust(state, command, proof), /illegal/);
  }
  assert.throws(() => servingAuthorization("PROVED", "aggregate-a"));
  assert.equal(servingAuthorization("AUTHORIZED", "aggregate-a").aggregateId, "aggregate-a");
});

test("complete vertical event history replays deterministically and authorizes only last", () => {
  const history = events.map((type, index) => envelope(type, index));
  const first = replayTrust(identity, history, resolveEvidence);
  const second = replayTrust(identity, history, resolveEvidence);
  assert.equal(first.state, "AUTHORIZED"); assert.equal(first.version, 4); assert.deepEqual(first, second);
  assert.equal(replayTrust(identity, history.slice(0, 3), resolveEvidence).state, "PROVED");
  assert.throws(() => replayTrust(identity, [history[0], history[2]], resolveEvidence), /illegal/);
  assert.throws(() => replayTrust(identity, [envelope("HypothesisProposed", 0, { tenantId: tenantId("tenant-b") })], resolveEvidence), /foreign/);
  assert.throws(() => replayTrust(identity, history, () => new TextEncoder().encode("tampered")), /verification failed/);
  assert.throws(() => replayTrust(identity, [envelope("CandidateGenerated", 1, { payload: { authority: "Dream" } })], resolveEvidence));
  const duplicate = replayTrust(identity, [history[0], history[0]], resolveEvidence); assert.equal(duplicate.version, 1);
});

test("envelope is canonical, immutable, closed, registered, and tamper evident", () => {
  const value = envelope("HypothesisProposed", 0);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.payload));
  assert.deepEqual(encodeEnvelope(value), encodeEnvelope(structuredClone(value)));
  assert.throws(() => createEnvelope({ ...value, surprise: true }), /unknown critical/);
  const registry = new EnvelopeSchemaRegistry();
  registry.register("HypothesisProposed", 1, (payload) => { if (payload.tenantId !== identity.tenantId) throw new TypeError("cross-tenant payload"); });
  registry.validate(value); assert.throws(() => registry.register("HypothesisProposed", 1, () => {}), /already/);
  assert.throws(() => registry.validate(envelope("CandidateGenerated", 1)), /UNKNOWN_SCHEMA_VERSION/);
  assert.notEqual(digestBytes(encodeEnvelope(value)), digestBytes(encodeEnvelope(envelope("HypothesisProposed", 0, { payload: { ...value.payload, step: 9 } }))));
});

test("same idempotency key remains tenant scoped", () => {
  const key = idempotencyKey(newIdempotencyKey());
  const first = envelope("HypothesisProposed", 0, { idempotencyKey: key });
  assert.equal(replayTrust(identity, [first, first], resolveEvidence).version, 1);
  const other = { tenantId: tenantId("tenant-b"), repositoryId: repositoryId("repo-a"), aggregateId: aggregateId("aggregate-a") };
  const second = envelope("HypothesisProposed", 0, { ...other, idempotencyKey: key, correlationId: correlationId(newCorrelationId()) });
  assert.equal(replayTrust(other, [second], resolveEvidence).version, 1);
});
