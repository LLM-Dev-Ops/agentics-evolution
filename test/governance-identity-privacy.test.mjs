import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { tenantId, repositoryId } from "../dist/index.js";
import { CryptographicOidcIdentityVerifier } from "../dist/infrastructure/governance/oidc-identity-verifier.js";
import { Ed25519DeletionReceiptSigner, Ed25519DeletionReceiptVerifier } from "../dist/infrastructure/governance/ed25519-deletion-receipts.js";
import { GovernanceEnforcementMiddleware } from "../dist/contexts/governance/application/enforcement-middleware.js";
import { DeletionCoordinator, deletionTombstone } from "../dist/contexts/governance/application/privacy-boundaries.js";
import { privacySafeLog, tenantMetricLabel, TenantBoundaryIssuer } from "../dist/contexts/governance/application/tenant-boundaries.js";
import { retentionDays, retentionExpiresAt, tenantSecurityProfile } from "../dist/contexts/governance/domain/privacy.js";
import { assertNoClassificationDowngrade, authorizeProvider, effectiveClassification } from "../dist/contexts/governance/domain/provider-policy.js";

const now = 1_800_000_000; const issuer = "https://identity.example"; const audience = "agentics-api";
const pair = generateKeyPairSync("ed25519"); const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
const trust = { issuer, audiences: [audience], algorithms: ["EdDSA"], keys: { k1: publicPem }, maximumTokenAgeSeconds: 300, clockSkewSeconds: 5,
  subjects: { alice: { kind: "HUMAN", tenantId: "tenant-a", groups: ["operators"], requireMfa: true }, worker: { kind: "SERVICE", tenantId: "tenant-a", serviceAccount: "worker@example.iam.gserviceaccount.com" } } };
function jwt(claims, header = { alg: "EdDSA", kid: "k1", typ: "JWT" }, key = pair.privateKey) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url"); const body = `${encode(header)}.${encode(claims)}`;
  return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
}
const base = { iss: issuer, sub: "alice", aud: audience, iat: now - 10, nbf: now - 10, exp: now + 60, amr: ["pwd", "mfa"] };

test("cryptographic OIDC verifies human MFA and server-side service mappings", async () => {
  const verifier = new CryptographicOidcIdentityVerifier([trust], () => now * 1000);
  const human = await verifier.verify(jwt(base), audience); assert.equal(human.kind, "HUMAN"); assert.equal(human.mfa, true); assert.deepEqual(human.groups, ["operators"]);
  const service = await verifier.verify(jwt({ ...base, sub: "worker", amr: [], email: "worker@example.iam.gserviceaccount.com" }), audience); assert.equal(service.kind, "SERVICE");
  await assert.rejects(verifier.verify(jwt({ ...base, amr: [] }), audience), /MFA_REQUIRED/);
  await assert.rejects(verifier.verify(jwt({ ...base, aud: "wrong" }), audience), /AUDIENCE/);
  await assert.rejects(verifier.verify(jwt({ ...base, exp: now - 10 }), audience), /TOKEN_TIME/);
  await assert.rejects(verifier.verify(jwt({ ...base, nbf: now + 60 }), audience), /TOKEN_TIME/);
  await assert.rejects(verifier.verify(jwt({ ...base, iat: now - 1000 }), audience), /TOKEN_TIME/);
  await assert.rejects(verifier.verify(jwt(base, { alg: "none", kid: "k1" })), /ALGORITHM/);
  const attacker = generateKeyPairSync("ed25519"); await assert.rejects(verifier.verify(jwt(base, undefined, attacker.privateKey), audience), /SIGNATURE/);
  await assert.rejects(verifier.verify(jwt({ ...base, sub: "unknown" }), audience), /SUBJECT/);
});

test("authentication cannot grant capability and middleware delegates exactly once to Governance", async () => {
  const verifier = new CryptographicOidcIdentityVerifier([trust], () => now * 1000); let calls = 0;
  const governance = { decide: async request => { calls++; assert.equal(request.identity.subject, "alice"); return { schema:"agentics.governance-decision/v1",allowed:true,action:request.action,tenantId:request.tenantId,repositoryId:request.repositoryId,policyEpoch:request.policyEpoch,decisionDigest:"a".repeat(64),evidenceDigest:"b".repeat(64),reason:"policy allow" }; } };
  const middleware = new GovernanceEnforcementMiddleware(verifier, governance,{append:async()=>{}}); const request = { tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), action: "cycle.read",policyEpoch:"epoch-1", correlationId: "corr-1" };
  const result = await middleware.authorize(jwt(base), request, audience); assert.equal(result.decision.allowed, true); assert.equal(calls, 1); assert.equal("capability" in result.identity, false);
  await assert.rejects(middleware.authorize(jwt(base), { ...request, tenantId: tenantId("tenant-b") }, audience), /TENANT_SCOPE/); assert.equal(calls, 1);
  const denied = new GovernanceEnforcementMiddleware(verifier, { decide: async value => ({schema:"agentics.governance-decision/v1",allowed:false,action:value.action,tenantId:value.tenantId,repositoryId:value.repositoryId,policyEpoch:value.policyEpoch,decisionDigest:"b".repeat(64),evidenceDigest:"c".repeat(64),reason:"deny"})},{append:async()=>{}});
  await assert.rejects(denied.authorize(jwt(base), request, audience), /AUTHORIZATION_DENIED/);
});

test("classification, provider, residency and guarded namespace helpers fail closed", async () => {
  const profile = tenantSecurityProfile({ tenantId: "tenant-a", region: "us-central1", maximumClassification: "RESTRICTED", providers: ["private-a"], trainingOptOut: true, retention: { ...retentionDays } });
  assert.equal(effectiveClassification(["PUBLIC", "RESTRICTED", "INTERNAL"]), "RESTRICTED"); assert.throws(() => assertNoClassificationDowngrade("RESTRICTED", "INTERNAL"), /DOWNGRADE/);
  authorizeProvider(profile, "RESTRICTED", { providerId: "private-a", region: "us-central1", trainingOptOut: true, privateOrLocal: true });
  assert.throws(() => authorizeProvider(profile, "RESTRICTED", { providerId: "private-a", region: "us-central1", trainingOptOut: true, privateOrLocal: false }), /RESTRICTED_PROVIDER/);
  assert.throws(() => authorizeProvider(profile, "SECRET_PROHIBITED", { providerId: "private-a", region: "us-central1", trainingOptOut: true, privateOrLocal: true }), /QUARANTINE/);
  const tenant = tenantId("tenant-a"), repo = repositoryId("repo-a"); const issuer=new TenantBoundaryIssuer({assertWritesAllowed:async()=>{}});
  assert.match(await issuer.cacheKey(tenant, repo, "cycle", "one"), /^t:tenant-a:r:repo-a:/);
  assert.match(await issuer.vectorNamespace(tenant, repo, "observations"), /tenant\/tenant-a\/repository\/repo-a/); assert.match(await issuer.keyAlias(tenant, repo, "receipt"), /tenants\/tenant-a/);
  assert.notEqual(tenantMetricLabel(tenant, Buffer.alloc(32, 1)), tenantMetricLabel(tenantId("tenant-b"), Buffer.alloc(32, 1)));
  assert.deepEqual(privacySafeLog({ correlationId: "c", prompt: "raw", accessToken: "secret", ok: true }), { correlationId: "c", ok: true });
  await assert.rejects(issuer.cacheKey(tenant, repo, "cycle", "../escape"), /NAMESPACE/);
  assert.equal(retentionExpiresAt("SCRATCH", "2027-01-01T00:00:00.000Z", profile), "2027-01-08T00:00:00.000Z");
  assert.throws(() => retentionExpiresAt("SCRATCH", "not-time", profile), /RETENTION_CLOCK/);
});

test("tombstone deletion requires every boundary and produces a tamper-evident scoped receipt", async () => {
  const tombstone = deletionTombstone({ tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), requestId: "delete-0001", requestedAt: "2027-01-15T08:00:00.000Z", policyEpoch: 7 });
  const categories = ["DATABASE", "ARTIFACT", "EVENT", "CACHE", "VECTOR", "KEY", "BACKUP_OBLIGATION"];
  const boundaries = categories.map(category => ({ category, delete: async (value, operationKey) => ({ category,operationKey,tenantId:value.tenantId,repositoryId:value.repositoryId,requestId:value.requestId,removed:value.tenantId === "tenant-a"?1:0,retained:category === "BACKUP_OBLIGATION"?1:0,held:0,digest:"a".repeat(64),acknowledgementDigest:"b".repeat(64) }), verify: async value => value.acknowledgementDigest === "b".repeat(64) }));
  const signing = generateKeyPairSync("ed25519"); const signer = new Ed25519DeletionReceiptSigner("delete-key/1", signing.privateKey.export({ type: "pkcs8", format: "pem" }));
  const receipt = await new DeletionCoordinator(boundaries, signer, () => new Date("2027-01-15T08:01:00.000Z")).execute(tombstone);
  const verifier = new Ed25519DeletionReceiptVerifier({ "delete-key/1": signing.publicKey.export({ type: "spki", format: "pem" }) }); assert.equal(verifier.verify(receipt), true); assert.equal(receipt.payload.results.length, 7);
  assert.equal(verifier.verify({ ...receipt, payload: { ...receipt.payload, completedAt: "2027-01-15T08:02:00.000Z" } }), false);
  await assert.rejects(new DeletionCoordinator(boundaries.slice(0, -1), signer).execute(tombstone), /BOUNDARY_MISSING/);
});
