import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    const valid = token(); await assert.rejects(cas.delete(ref, { receipt: `${valid.receipt.slice(0, -1)}x` }), /ACCESS_SIGNATURE/);
    await assert.rejects(cas.delete(ref, token({ repositoryId: repositoryId("repo-b") })), /NOT_FOUND/);
    await cas.delete(ref, token()); assert.equal(await cas.exists(ref), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
