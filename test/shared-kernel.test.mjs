import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  actorId, aggregateId, authorizeServing, canonicalJson, causationId, correlationId, createEnvelope, cycleId, decodeEnvelope, digestBytes, digestReference,
  Ed25519AuthorityEvidenceVerifier,
  emptyTrustAggregate, encodeEnvelope, EnvelopeSchemaRegistry, eventId, idempotencyKey, money,
  moneyFromWire, moneyToWire, newCausationId, newCorrelationId, newEventId, newIdempotencyKey,
  replayTrust, repositoryId, sourceSnapshot, tenantId, transitionEventBinding, transitionTrust, utcInstant
} from "../dist/index.js";

const identity = Object.freeze({ tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), aggregateId: aggregateId("aggregate-a") });
const events = ["HypothesisProposed", "CandidateGenerated", "EvaluationAccepted", "PromotionAuthorized"];
const authorities = ["Dream", "Darwin", "Flywheel", "Governance"];
const authorityKeys = generateKeyPairSync("ed25519");
const authorityVerifier = new Ed25519AuthorityEvidenceVerifier(authorities.map((authority) => ({ authority, keyId: `${authority.toLowerCase()}-key`, publicKeyPem: authorityKeys.publicKey.export({ type: "spki", format: "pem" }) })));
const trustRegistry = new EnvelopeSchemaRegistry();
for (const type of [...events, "AuthorizationRevoked"]) trustRegistry.register(type, 1, { schemaId: "agentics.trust-payload/v1", allowedFields: ["tenantId", "repositoryId", "step"], requiredFields: ["tenantId", "repositoryId"] });
const evidenceStore = new Map();
const resolveEvidence = (reference) => evidenceStore.get(reference.uri) ?? new Uint8Array();
function envelope(type, index, overrides = {}) {
  const authority = authorities[index] ?? "Governance";
  const base = { envelopeSchema: "agentics.evolution-envelope/v1", schemaVersion: 1, id: newEventId(), type, ...identity,
    cycleId: cycleId("cycle-a"), actorId: actorId("actor-a"), occurredAt: utcInstant(`2026-08-12T00:00:0${index}.000Z`),
    causationId: newCausationId(), correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey(), policyEpoch: 1,
    sourceRef: sourceSnapshot({ commit: "a".repeat(40), dirtySnapshot: null }), evidence: [],
    payload: { tenantId: identity.tenantId, repositoryId: identity.repositoryId, step: index }, ...overrides };
  const eventBinding = transitionEventBinding(base);
  const gateBytes = new TextEncoder().encode("flywheel-gate-receipt"); const gateSha = digestBytes(gateBytes);
  const alphaBytes = new TextEncoder().encode("flywheel-sequential-evidence"); const alphaSha = digestBytes(alphaBytes);
  const gateReference = digestReference({ uri: `cas://sha256/${gateSha}`, sha256: gateSha });
  const alphaReference = digestReference({ uri: `cas://sha256/${alphaSha}`, sha256: alphaSha });
  evidenceStore.set(gateReference.uri, gateBytes); evidenceStore.set(alphaReference.uri, alphaBytes);
  const statement = { schema: "agentics.authority-evidence/v1", keyId: `${authority.toLowerCase()}-key`, authority, eventBinding,
    verdict: authority === "Dream" ? "VALIDATED" : authority === "Darwin" ? "ADMITTED" : authority === "Flywheel" ? "PROVED" : "AUTHORIZED",
    proof: authority === "Dream" ? { sourceValidated: true } : authority === "Darwin" ? { mutationAdmitted: true }
      : authority === "Flywheel" ? { gateReceipt: gateReference, replayVerdict: "PASS", sequentialEvidence: alphaReference }
      : { approvalId: "approval-a", capability: type === "AuthorizationRevoked" ? "REVOKE" : "PROMOTE", constraints: { environment: "production" } } };
  const signature = sign(null, Buffer.from(canonicalJson(statement)), authorityKeys.privateKey).toString("base64");
  const evidenceBytes = new TextEncoder().encode(JSON.stringify({ ...statement, signature }));
  const evidenceSha = digestBytes(evidenceBytes);
  const evidence = digestReference({ uri: `cas://sha256/${evidenceSha}`, sha256: evidenceSha });
  evidenceStore.set(evidence.uri, evidenceBytes);
  return createEnvelope({ ...base, evidence: [evidence] });
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
  assert.throws(() => sourceSnapshot({ objectFormat: "sha256", commit: "a".repeat(40), dirtySnapshot: null }), /object format/);
  assert.throws(() => money(1n, "ZZZ"), /supported ISO/);
  assert.throws(() => money(10n ** 24n + 1n, "USD"), /range/);
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
});

test("complete vertical event history replays deterministically and authorizes only last", () => {
  const history = events.map((type, index) => envelope(type, index));
  const first = replayTrust(identity, history, trustRegistry, resolveEvidence, authorityVerifier);
  const second = replayTrust(identity, history, trustRegistry, resolveEvidence, authorityVerifier);
  assert.equal(first.state, "AUTHORIZED"); assert.equal(first.version, 4); assert.deepEqual(first, second);
  assert.equal(authorizeServing(first).aggregateId, identity.aggregateId);
  assert.equal(replayTrust(identity, history.slice(0, 3), trustRegistry, resolveEvidence, authorityVerifier).state, "PROVED");
  assert.throws(() => replayTrust(identity, [history[0], history[2]], trustRegistry, resolveEvidence, authorityVerifier), /illegal/);
  assert.throws(() => replayTrust(identity, [envelope("HypothesisProposed", 0, { tenantId: tenantId("tenant-b"), payload: { tenantId: "tenant-b", repositoryId: "repo-a" } })], trustRegistry, resolveEvidence, authorityVerifier), /foreign/);
  assert.throws(() => replayTrust(identity, history, trustRegistry, () => new TextEncoder().encode("tampered"), authorityVerifier), /verification failed/);
  assert.throws(() => replayTrust(identity, history, trustRegistry, resolveEvidence, Object.create(null)), /configured Ed25519/);
  class Permissive extends Ed25519AuthorityEvidenceVerifier { verify() { return true; } }
  const malicious = new Permissive(authorities.map((authority) => ({ authority, keyId: `${authority.toLowerCase()}-evil`, publicKeyPem: authorityKeys.publicKey.export({ type: "spki", format: "pem" }) })));
  assert.equal(Object.hasOwn(malicious, "verify"), true);
  assert.throws(() => { malicious.verify = () => true; }, /read only|Cannot assign/);
  const duplicate = replayTrust(identity, [history[0], history[0]], trustRegistry, resolveEvidence, authorityVerifier); assert.equal(duplicate.version, 1);
  const conflicting = envelope("HypothesisProposed", 0, { idempotencyKey: history[0].idempotencyKey, payload: { ...history[0].payload, step: 99 } });
  assert.throws(() => replayTrust(identity, [history[0], conflicting], trustRegistry, resolveEvidence, authorityVerifier), /conflicting/);
  const revoked = replayTrust(identity, [...history, envelope("AuthorizationRevoked", 4)], trustRegistry, resolveEvidence, authorityVerifier);
  assert.throws(() => authorizeServing(revoked), /active AUTHORIZED/);
});

test("envelope is canonical, immutable, closed, registered, and tamper evident", () => {
  const value = envelope("HypothesisProposed", 0);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.payload));
  assert.deepEqual(encodeEnvelope(value), encodeEnvelope(structuredClone(value)));
  assert.throws(() => createEnvelope({ ...value, surprise: true }), /unknown critical/);
  const registry = new EnvelopeSchemaRegistry();
  registry.register("HypothesisProposed", 1, { schemaId: "agentics.trust-payload/v1", allowedFields: ["tenantId", "repositoryId", "step"], requiredFields: ["tenantId"], compatibleReaderVersions: [1] });
  registry.validate(value); assert.throws(() => registry.register("HypothesisProposed", 1, { schemaId: "agentics.trust-payload/v1", allowedFields: [] }), /already/);
  assert.deepEqual(decodeEnvelope(encodeEnvelope(value), registry), value);
  assert.throws(() => decodeEnvelope(new TextEncoder().encode("not json"), registry), /INVALID_ENVELOPE_JSON/);
  assert.throws(() => registry.validate(envelope("CandidateGenerated", 1)), /UNKNOWN_SCHEMA_VERSION/);
  assert.equal(registry.negotiateReader("HypothesisProposed", 1, [1]), 1);
  assert.throws(() => registry.negotiateReader("HypothesisProposed", 1, [2]), /INCOMPATIBLE/);
  assert.throws(() => registry.validate(envelope("HypothesisProposed", 0, { payload: { tenantId: "tenant-a", repositoryId: "repo-a", surprise: true } })), /unknown critical payload/);
  assert.throws(() => envelope("HypothesisProposed", 0, { payload: { tenantId: "tenant-b", authority: "Dream" } }), /cross-tenant/);
  assert.throws(() => envelope("HypothesisProposed", 0, { payload: { repositoryId: "repo-b", authority: "Dream" } }), /cross-repository/);
  assert.notEqual(digestBytes(encodeEnvelope(value)), digestBytes(encodeEnvelope(envelope("HypothesisProposed", 0, { payload: { ...value.payload, step: 9 } }))));
});

test("same idempotency key remains tenant scoped", () => {
  const key = idempotencyKey(newIdempotencyKey());
  const first = envelope("HypothesisProposed", 0, { idempotencyKey: key });
  assert.equal(replayTrust(identity, [first, first], trustRegistry, resolveEvidence, authorityVerifier).version, 1);
  const other = { tenantId: tenantId("tenant-b"), repositoryId: repositoryId("repo-a"), aggregateId: aggregateId("aggregate-a") };
  const second = envelope("HypothesisProposed", 0, { ...other, idempotencyKey: key, correlationId: correlationId(newCorrelationId()),
    payload: { tenantId: other.tenantId, repositoryId: other.repositoryId } });
  assert.equal(replayTrust(other, [second], trustRegistry, resolveEvidence, authorityVerifier).version, 1);
});
