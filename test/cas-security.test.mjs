import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { digestBytes, digestReference, repositoryId, tenantId } from "../dist/index.js";
import { HmacArtifactAccessAuthority } from "../dist/infrastructure/artifact-lineage/hmac-artifact-access.js";
import { LocalContentAddressedStorage } from "../dist/contexts/artifact-lineage/infrastructure/local-cas.js";

const reference = (bytes) => { const sha256 = digestBytes(bytes); return digestReference({ uri: `cas://sha256/${sha256}`, sha256 }); };
const metadata = { tenantId: tenantId("tenant-a"), repositoryId: repositoryId("repo-a"), mediaType: "application/octet-stream",
  classification: "CONFIDENTIAL", retention: "OPERATIONAL_SCRATCH", legalHold: false };
const access = new HmacArtifactAccessAuthority(Buffer.alloc(32, 7));
const readGrant = (overrides = {}) => access.issueRead({ tenantId: metadata.tenantId, repositoryId: metadata.repositoryId, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides });

test("streaming stage enforces declared size and digest without partial residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "cas-stream-")); const cas = new LocalContentAddressedStorage(root, 32, access);
  try {
    const bytes = new TextEncoder().encode("streamed artifact"); const ref = reference(bytes);
    const chunks = (async function* () { yield bytes.slice(0, 4); yield bytes.slice(4); })();
    const staged = await cas.stageStream(chunks, ref, bytes.byteLength, metadata); await cas.finalize(staged);
    assert.deepEqual([...await cas.read(ref, readGrant())], [...bytes]);
    await assert.rejects(cas.stageStream((async function* () { yield bytes; })(), ref, bytes.byteLength - 1, metadata), /TOO_LARGE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("POSIX finalization cannot clobber an existing digest path", async () => {
  const root = await mkdtemp(join(tmpdir(), "cas-clobber-")); const cas = new LocalContentAddressedStorage(root, undefined, access); const bytes = new TextEncoder().encode("immutable"); const ref = reference(bytes);
  try {
    const staged = await cas.stage(bytes, ref, metadata); await cas.finalize(staged);
    const second = await cas.stage(bytes, ref, metadata); await writeFile(join(root, "staging", second.stageId), "different");
    await assert.rejects(cas.finalize(second), /TAMPERED/);
    assert.equal((await readFile(join(root, "sha256", ref.sha256.slice(0, 2), ref.sha256), "utf8")), "immutable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delete requires a scoped live fenced intent token", async () => {
  const root = await mkdtemp(join(tmpdir(), "cas-delete-")); const cas = new LocalContentAddressedStorage(root, undefined, access); const bytes = new TextEncoder().encode("delete me"); const ref = reference(bytes);
  try {
    await cas.finalize(await cas.stage(bytes, ref, metadata));
    const token = (overrides = {}) => access.issueDelete({ tenantId: metadata.tenantId, repositoryId: metadata.repositoryId, digest: ref.sha256,
      intentId: "intent-1", expiresAt: new Date(Date.now() + 60_000).toISOString(), fencingToken: 1, ...overrides });
    await assert.rejects(cas.delete(ref, token({ digest: "00".repeat(32) })), /INVALID_DELETE_TOKEN/);
    await assert.rejects(cas.delete(ref, token({ expiresAt: "2020-01-01T00:00:00Z" })), /ACCESS_EXPIRED/);
    const valid = token(); const [payload, signature] = valid.receipt.split(".");
    await assert.rejects(cas.delete(ref, { receipt: `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}` }), /ACCESS_SIGNATURE/);
    await assert.rejects(cas.delete(ref, token({ repositoryId: repositoryId("repo-b") })), /NOT_FOUND/);
    await cas.delete(ref, token()); assert.equal(await cas.exists(ref), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("identical bytes have independent tenant scopes and cannot be deleted by an unscoped tenant", async () => {
  const root = await mkdtemp(join(tmpdir(), "cas-shared-")); const cas = new LocalContentAddressedStorage(root, undefined, access); const bytes = new TextEncoder().encode("shared"); const ref = reference(bytes);
  const tenantB = tenantId("tenant-b"); const repoB = repositoryId("repo-b"); const metadataB = { ...metadata, tenantId: tenantB, repositoryId: repoB };
  try {
    await cas.finalize(await cas.stage(bytes, ref, metadata)); await cas.finalize(await cas.stage(bytes, ref, metadataB));
    assert.deepEqual([...await cas.read(ref, readGrant())], [...bytes]);
    assert.deepEqual([...await cas.read(ref, access.issueRead({ tenantId: tenantB, repositoryId: repoB, expiresAt: new Date(Date.now() + 60_000).toISOString() }))], [...bytes]);
    const wrong = access.issueDelete({ tenantId: tenantId("tenant-c"), repositoryId: repositoryId("repo-c"), digest: ref.sha256, intentId: "unscoped", expiresAt: new Date(Date.now() + 60_000).toISOString(), fencingToken: 1 });
    await assert.rejects(cas.delete(ref, wrong), /NOT_FOUND/); assert.equal(await cas.exists(ref), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent tenant finalization preserves every scope without lost updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "cas-concurrent-")); const cas = new LocalContentAddressedStorage(root, undefined, access); const bytes = new TextEncoder().encode("concurrent-shared"); const ref = reference(bytes);
  const scopes = Array.from({ length: 12 }, (_, index) => ({ ...metadata, tenantId: tenantId(`tenant-${index}`), repositoryId: repositoryId(`repo-${index}`) }));
  try {
    const staged = await Promise.all(scopes.map((scope) => cas.stage(bytes, ref, scope))); await Promise.all(staged.map((item) => cas.finalize(item)));
    for (const scope of scopes) assert.deepEqual([...await cas.read(ref, access.issueRead({ tenantId: scope.tenantId, repositoryId: scope.repositoryId,
      expiresAt: new Date(Date.now() + 60_000).toISOString() }))], [...bytes]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("expired lock cannot be stolen from a live owner and recovers after SIGKILL", async () => {
  const root = await mkdtemp(join(tmpdir(), "cas-kill-")); const cas = new LocalContentAddressedStorage(root, undefined, access); const contender = new LocalContentAddressedStorage(root, undefined, access); const bytes = new TextEncoder().encode("kill-recovery"); const ref = reference(bytes);
  const [staged, stagedTwo] = await Promise.all([cas.stage(bytes, ref, metadata), contender.stage(bytes, ref, metadata)]); const lock = join(root, "locks", ref.sha256);
  const child = spawn(process.execPath, [new URL("fixtures/cas-lock-owner.mjs", import.meta.url).pathname, lock], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise((resolve) => child.stdout.once("data", resolve));
    let resolved = false; const pending = Promise.all([cas.finalize(staged), contender.finalize(stagedTwo)]).then(() => { resolved = true; }); await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(resolved, false);
    child.kill("SIGKILL"); await new Promise((resolve) => child.once("exit", resolve));
    await pending; assert.equal(await cas.exists(ref), true);
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
});
