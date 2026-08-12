import { randomUUID } from "node:crypto";
import type { Bucket } from "@google-cloud/storage";
import { digestBytes, digestReference, type DigestReference } from "../../shared-kernel/digest.js";
import type { TenantId } from "../../shared-kernel/identity.js";
import type { ArtifactWriteMetadata, ContentAddressedStoragePort, StagedArtifact } from "../../contexts/artifact-lineage/application/cas-port.js";

export class GcsContentAddressedStorage implements ContentAddressedStoragePort {
  constructor(readonly bucket: Bucket, readonly prefix = "cas", readonly maximumBytes = 256 * 1024 * 1024) {}
  async stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact> {
    digestReference(expected); if (bytes.byteLength > this.maximumBytes) throw new TypeError("ARTIFACT_TOO_LARGE");
    if (digestBytes(bytes) !== expected.sha256) throw new TypeError("ARTIFACT_DIGEST_MISMATCH");
    const stageId = randomUUID(); const file = this.bucket.file(`${this.prefix}/staging/${stageId}`);
    await file.save(Buffer.from(bytes), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: metadata.mediaType,
      metadata: encodeMetadata({ ...metadata, expectedSha256: expected.sha256, expectedSize: String(bytes.byteLength), stageId }) } });
    return Object.freeze({ stageId, expected, size: bytes.byteLength, metadata });
  }
  async finalize(staged: StagedArtifact): Promise<DigestReference> {
    const source = this.bucket.file(`${this.prefix}/staging/${staged.stageId}`); const [bytes] = await source.download();
    if (bytes.byteLength !== staged.size || digestBytes(bytes) !== staged.expected.sha256) throw new TypeError("STAGED_ARTIFACT_TAMPERED");
    const destination = this.bucket.file(this.finalName(staged.expected));
    try {
      await destination.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: staged.metadata.mediaType,
        metadata: encodeMetadata({ ...staged.metadata, sha256: staged.expected.sha256, size: String(staged.size) }) } });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      const [existing] = await destination.download(); if (existing.byteLength !== staged.size || digestBytes(existing) !== staged.expected.sha256) throw new TypeError("CAS_COLLISION");
    }
    await source.delete({ ignoreNotFound: true }); return staged.expected;
  }
  async read(reference: DigestReference, tenantId: TenantId): Promise<Uint8Array> {
    digestReference(reference); const file = this.bucket.file(this.finalName(reference)); const [metadata] = await file.getMetadata();
    if (metadata.metadata?.tenantId !== tenantId) throw new TypeError("ARTIFACT_NOT_FOUND"); const [bytes] = await file.download();
    if (digestBytes(bytes) !== reference.sha256) throw new TypeError("CAS_OBJECT_TAMPERED"); return bytes;
  }
  async exists(reference: DigestReference): Promise<boolean> { return (await this.bucket.file(this.finalName(reference)).exists())[0]; }
  async delete(reference: DigestReference): Promise<void> { await this.bucket.file(this.finalName(reference)).delete(); }
  private finalName(reference: DigestReference): string { return `${this.prefix}/sha256/${reference.sha256.slice(0, 2)}/${reference.sha256}`; }
}
function encodeMetadata(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item)]));
}
