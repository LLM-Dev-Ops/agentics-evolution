import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { GcsContentAddressedStorage } from "../dist/infrastructure/artifact-lineage/gcs-cas.js";
import { digestBytes, digestReference, repositoryId, tenantId } from "../dist/index.js";
import { HmacArtifactAccessAuthority } from "../dist/infrastructure/artifact-lineage/hmac-artifact-access.js";

class FakeBucket {
  objects = new Map();
  copyCalls = [];
  deleteCalls = [];
  bumpGenerationAfterMetadata = null;
  policy = { iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" }, versioning: { enabled: true } };
  file(name) { return new FakeFile(this, name); }
  async getMetadata() { return [structuredClone(this.policy)]; }
  put(name, bytes, metadata = {}) {
    const previous = this.objects.get(name);
    const generation = String(Number(previous?.generation ?? 0) + 1);
    this.objects.set(name, { bytes: Buffer.from(bytes), metadata: structuredClone(metadata), generation, metageneration: "1" });
  }
}

class FakeFile {
  constructor(bucket, name) { this.bucket = bucket; this.name = name; }
  createWriteStream(options) {
    assert.equal(options.resumable, true);
    assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
    const chunks = [];
    return new Writable({
      write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
      final: callback => {
        if (this.bucket.objects.has(this.name)) return callback(Object.assign(new Error("precondition"), { code: 412 }));
        this.bucket.put(this.name, Buffer.concat(chunks), options.metadata); callback();
      }
    });
  }
  createReadStream() {
    const object = this.bucket.objects.get(this.name);
    if (!object) return Readable.from((async function* () { throw Object.assign(new Error("not found"), { code: 404 }); })());
    return Readable.from([object.bytes.subarray(0, Math.ceil(object.bytes.length / 2)), object.bytes.subarray(Math.ceil(object.bytes.length / 2))]);
  }
  async copy(destination, options) {
    this.bucket.copyCalls.push({ source: this.name, destination: destination.name, options: structuredClone(options) });
    assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
    if (this.bucket.objects.has(destination.name)) throw Object.assign(new Error("precondition"), { code: 412 });
    const source = this.bucket.objects.get(this.name); if (!source) throw Object.assign(new Error("not found"), { code: 404 });
    this.bucket.put(destination.name, source.bytes, source.metadata); return [[]];
  }
  async setMetadata(metadata, options = {}) {
    const object = this.bucket.objects.get(this.name); if (!object) throw Object.assign(new Error("not found"), { code: 404 });
    if (options.preconditionOpts?.ifMetagenerationMatch !== undefined && Number(object.metageneration ?? 1) !== options.preconditionOpts.ifMetagenerationMatch)
      throw Object.assign(new Error("precondition"), { code: 412 });
    object.metadata = structuredClone(metadata); object.metageneration = String(Number(object.metageneration) + 1); return [structuredClone(metadata)];
  }
  async getMetadata() {
    const object = this.bucket.objects.get(this.name); if (!object) throw Object.assign(new Error("not found"), { code: 404 });
    const result = { ...structuredClone(object.metadata), generation: object.generation, metageneration: object.metageneration };
    if (this.bucket.bumpGenerationAfterMetadata === this.name) { object.generation = String(Number(object.generation) + 1); this.bucket.bumpGenerationAfterMetadata = null; }
    return [result];
  }
  async download() {
    const object = this.bucket.objects.get(this.name); if (!object) throw Object.assign(new Error("not found"), { code: 404 });
    return [Buffer.from(object.bytes)];
  }
  async exists() { return [this.bucket.objects.has(this.name)]; }
  async delete(options = {}) {
    this.bucket.deleteCalls.push({ name: this.name, options: structuredClone(options) });
    const object = this.bucket.objects.get(this.name);
    if (!object) { if (options.ignoreNotFound) return; throw Object.assign(new Error("not found"), { code: 404 }); }
    if (options.ifGenerationMatch !== undefined && Number(object.generation) !== options.ifGenerationMatch)
      throw Object.assign(new Error("precondition"), { code: 412 });
    this.bucket.objects.delete(this.name);
  }
}

const tenant = tenantId("tenant-a");
const repository = repositoryId("repo-a");
const metadata = { tenantId: tenant, repositoryId: repository, mediaType: "application/octet-stream", classification: "CONFIDENTIAL", retention: "OPERATIONAL_SCRATCH", legalHold: false };
const reference = bytes => { const sha256 = digestBytes(bytes); return digestReference({ uri: `cas://sha256/${sha256}`, sha256 }); };
const access = {
  verifyRead: async grant => {
    if (grant.receipt !== "read-a") throw new TypeError("INVALID_READ_GRANT");
    return { tenantId: tenant, repositoryId: repository, expiresAt: "2099-01-01T00:00:00.000Z" };
  },
  verifyDelete: async token => {
    if (token.receipt !== "delete-a") throw new TypeError("INVALID_DELETE_TOKEN");
    return { tenantId: tenant, repositoryId: repository, digest: token.digest, intentId: "intent-1", fencingToken: 1, expiresAt: "2099-01-01T00:00:00.000Z" };
  }
};

test("GCS contract streams staging and finalizes with a generation-zero server-side copy", async () => {
  const bucket = new FakeBucket(); const cas = new GcsContentAddressedStorage(bucket, access); const bytes = Buffer.from("streamed-gcs-object"); const ref = reference(bytes);
  const staged = await cas.stageStream(Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), ref, bytes.length, metadata);
  await cas.finalize(staged);
  assert.equal(bucket.copyCalls.length, 1);
  assert.equal(bucket.copyCalls[0].options.preconditionOpts.ifGenerationMatch, 0);
  assert.deepEqual(await cas.read(ref, { receipt: "read-a" }), bytes);
  await assert.rejects(cas.read(ref, { receipt: "forged" }), /INVALID_READ_GRANT/);
});

test("GCS contract rejects staging tamper and distinguishes immutable dedupe from collision", async () => {
  const bucket = new FakeBucket(); const cas = new GcsContentAddressedStorage(bucket, access); const bytes = Buffer.from("immutable-gcs-object"); const ref = reference(bytes);
  const first = await cas.stage(bytes, ref, metadata); await cas.finalize(first);
  const duplicate = await cas.stage(bytes, ref, metadata); await cas.finalize(duplicate);
  assert.equal(bucket.copyCalls.length, 2, "dedupe still attempts generation-zero copy");
  const finalName = `cas/sha256/${ref.sha256.slice(0, 2)}/${ref.sha256}`;
  bucket.objects.get(finalName).bytes = Buffer.from("corrupt destination");
  const collision = await cas.stage(bytes, ref, metadata);
  await assert.rejects(cas.finalize(collision), /CAS_COLLISION/);
  const staged = await cas.stage(bytes, ref, metadata);
  bucket.objects.get(`cas/staging/${staged.stageId}`).bytes = Buffer.from("tampered staging");
  await assert.rejects(cas.finalize(staged), /STAGED_ARTIFACT_TAMPERED/);
});

test("GCS contract scopes reads/deletes, uses generation fencing, and enforces bucket readiness", async () => {
  const bucket = new FakeBucket(); const cas = new GcsContentAddressedStorage(bucket, access); const bytes = Buffer.from("scoped-gcs-object"); const ref = reference(bytes);
  await cas.finalize(await cas.stage(bytes, ref, metadata));
  const finalName = `cas/sha256/${ref.sha256.slice(0, 2)}/${ref.sha256}`;
  bucket.objects.get(finalName).metadata.metadata.scopes = JSON.stringify([{ tenantId: tenant, repositoryId: "repo-b" }]);
  await assert.rejects(cas.read(ref, { receipt: "read-a" }), /ARTIFACT_NOT_FOUND/);
  await assert.rejects(cas.delete(ref, { receipt: "delete-a", digest: ref.sha256 }), /ARTIFACT_NOT_FOUND/);
  bucket.objects.get(finalName).metadata.metadata.scopes = JSON.stringify([{ tenantId: tenant, repositoryId: repository }]);
  bucket.bumpGenerationAfterMetadata = finalName;
  await assert.rejects(cas.delete(ref, { receipt: "delete-a", digest: ref.sha256 }), error => error?.code === 412);
  await cas.delete(ref, { receipt: "delete-a", digest: ref.sha256 });
  assert.ok(bucket.deleteCalls.some(call => call.name === finalName && Number.isSafeInteger(call.options.ifGenerationMatch)));
  assert.equal(await cas.exists(ref), false);
  await cas.delete(ref, { receipt: "delete-a", digest: ref.sha256 }); // idempotent missing delete
  await cas.readiness();
  bucket.policy.iamConfiguration.publicAccessPrevention = "inherited";
  await assert.rejects(cas.readiness(), /GCS_BUCKET_ACCESS_POLICY_UNSAFE/);
  bucket.policy.iamConfiguration.publicAccessPrevention = "enforced"; bucket.policy.versioning.enabled = false;
  await assert.rejects(cas.readiness(), /GCS_BUCKET_VERSIONING_REQUIRED/);
});

test("GCS contract preserves every scope when identical bytes deduplicate", async () => {
  const bucket = new FakeBucket(); const access = new HmacArtifactAccessAuthority(Buffer.alloc(32, 5)); const cas = new GcsContentAddressedStorage(bucket, access, "cas", 1024);
  const bytes = Buffer.from("shared-gcs"); const sha256 = digestBytes(bytes); const ref = digestReference({ uri: `cas://sha256/${sha256}`, sha256 });
  const tenantA = tenantId("tenant-a"), tenantB = tenantId("tenant-b"), repo = repositoryId("repo-a");
  const meta = tenantId => ({ tenantId, repositoryId: repo, mediaType: "application/octet-stream", classification: "CONFIDENTIAL", retention: "OPERATIONAL_SCRATCH", legalHold: false });
  await cas.finalize(await cas.stage(bytes, ref, meta(tenantA))); await cas.finalize(await cas.stage(bytes, ref, meta(tenantB)));
  const grant = tenantId => access.issueRead({ tenantId, repositoryId: repo, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.deepEqual([...await cas.read(ref, grant(tenantA))], [...bytes]); assert.deepEqual([...await cas.read(ref, grant(tenantB))], [...bytes]);
});
