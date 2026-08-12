import { createHash, randomUUID } from "node:crypto";
import type { Bucket } from "@google-cloud/storage";
import { digestBytes, digestReference, type DigestReference } from "../../shared-kernel/digest.js";
import type { ArtifactAccessVerifier, ArtifactDeleteToken, ArtifactReadGrant, ArtifactWriteMetadata, ContentAddressedStoragePort, StagedArtifact } from "../../contexts/artifact-lineage/application/cas-port.js";

export class GcsContentAddressedStorage implements ContentAddressedStoragePort {
  constructor(readonly bucket: Bucket, readonly access: ArtifactAccessVerifier, readonly prefix = "cas", readonly maximumBytes = 256 * 1024 * 1024) {}
  async stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact> {
    return this.stageStream((async function* () { yield bytes; })(), expected, bytes.byteLength, metadata);
  }
  async stageStream(chunks: AsyncIterable<Uint8Array>, expected: DigestReference, expectedSize: number, metadata: ArtifactWriteMetadata): Promise<StagedArtifact> {
    digestReference(expected); if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > this.maximumBytes) throw new TypeError("ARTIFACT_TOO_LARGE");
    const stageId = randomUUID(); const file = this.bucket.file(`${this.prefix}/staging/${stageId}`);
    const stream = file.createWriteStream({ resumable: true, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: metadata.mediaType,
      metadata: encodeMetadata({ ...metadata, expectedSha256: expected.sha256, expectedSize: String(expectedSize), stageId }) } });
    const completed = new Promise<void>((accept, reject) => { stream.once("finish", accept); stream.once("error", reject); });
    const hash = createHash("sha256"); let size = 0;
    try { for await (const chunk of chunks) { size += chunk.byteLength; if (size > expectedSize) throw new TypeError("ARTIFACT_TOO_LARGE"); hash.update(chunk);
      if (!stream.write(chunk)) await new Promise<void>((accept) => stream.once("drain", accept)); } stream.end(); await completed; }
    catch (error) { stream.destroy(); await file.delete({ ignoreNotFound: true }).catch(() => undefined); throw error; }
    if (size !== expectedSize || hash.digest("hex") !== expected.sha256) { await file.delete({ ignoreNotFound: true }); throw new TypeError("ARTIFACT_DIGEST_MISMATCH"); }
    return Object.freeze({ stageId, expected, size, metadata });
  }
  async finalize(staged: StagedArtifact): Promise<DigestReference> {
    const source = this.bucket.file(`${this.prefix}/staging/${staged.stageId}`); await assertFileDigest(source, staged.size, staged.expected.sha256, "STAGED_ARTIFACT_TAMPERED");
    const destination = this.bucket.file(this.finalName(staged.expected));
    try {
      await source.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } });
      await destination.setMetadata({ contentType: staged.metadata.mediaType, metadata: encodeMetadata({ ...staged.metadata, sha256: staged.expected.sha256, size: String(staged.size) }) });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      await assertFileDigest(destination, staged.size, staged.expected.sha256, "CAS_COLLISION");
    }
    await source.delete({ ignoreNotFound: true }); return staged.expected;
  }
  async read(reference: DigestReference, grant: ArtifactReadGrant): Promise<Uint8Array> {
    const verified = await this.access.verifyRead(grant); digestReference(reference); const file = this.bucket.file(this.finalName(reference)); const [metadata] = await file.getMetadata();
    if (metadata.metadata?.tenantId !== verified.tenantId || metadata.metadata?.repositoryId !== verified.repositoryId) throw new TypeError("ARTIFACT_NOT_FOUND"); const [bytes] = await file.download();
    if (digestBytes(bytes) !== reference.sha256) throw new TypeError("CAS_OBJECT_TAMPERED"); return bytes;
  }
  async exists(reference: DigestReference): Promise<boolean> { return (await this.bucket.file(this.finalName(reference)).exists())[0]; }
  async delete(reference: DigestReference, token: ArtifactDeleteToken): Promise<void> {
    const verified = await this.access.verifyDelete(token); if (verified.digest !== reference.sha256) throw new TypeError("INVALID_DELETE_TOKEN");
    const file = this.bucket.file(this.finalName(reference)); const [metadata] = await file.getMetadata().catch((error: { code?: number }) => {
      if (error.code === 404) return [{ metadata: {}, generation: undefined }] as never; throw error;
    });
    if (!metadata.generation) return;
    if (metadata.metadata?.tenantId !== verified.tenantId || metadata.metadata?.repositoryId !== verified.repositoryId) throw new TypeError("ARTIFACT_NOT_FOUND");
    await file.delete({ ifGenerationMatch: Number(metadata.generation) });
  }
  async readiness(): Promise<void> {
    const [metadata] = await this.bucket.getMetadata();
    if (metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true || metadata.iamConfiguration?.publicAccessPrevention !== "enforced")
      throw new TypeError("GCS_BUCKET_ACCESS_POLICY_UNSAFE");
    if (!metadata.versioning?.enabled) throw new TypeError("GCS_BUCKET_VERSIONING_REQUIRED");
  }
  private finalName(reference: DigestReference): string { return `${this.prefix}/sha256/${reference.sha256.slice(0, 2)}/${reference.sha256}`; }
}
async function assertFileDigest(file: ReturnType<Bucket["file"]>, expectedSize: number, expectedDigest: string, failure: string): Promise<void> {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of file.createReadStream()) { const bytes = chunk as Buffer; size += bytes.byteLength; hash.update(bytes); }
  if (size !== expectedSize || hash.digest("hex") !== expectedDigest) throw new TypeError(failure);
}
function encodeMetadata(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item)]));
}
