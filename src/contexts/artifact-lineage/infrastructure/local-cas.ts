import { link, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { digestBytes, digestReference, type DigestReference } from "../../../shared-kernel/digest.js";
import type { ArtifactDeleteToken, ArtifactReadGrant, ArtifactWriteMetadata, ContentAddressedStoragePort, StagedArtifact } from "../application/cas-port.js";

export class LocalContentAddressedStorage implements ContentAddressedStoragePort {
  readonly root: string; readonly maximumBytes: number;
  constructor(root: string, maximumBytes = 256 * 1024 * 1024) { this.root = resolve(root); this.maximumBytes = maximumBytes; }
  async stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact> {
    return this.stageStream((async function* () { yield bytes; })(), expected, bytes.byteLength, metadata);
  }
  async stageStream(chunks: AsyncIterable<Uint8Array>, expected: DigestReference, expectedSize: number, metadata: ArtifactWriteMetadata): Promise<StagedArtifact> {
    digestReference(expected); if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > this.maximumBytes) throw new TypeError("ARTIFACT_TOO_LARGE");
    const stageId = randomUUID(); const path = this.stagePath(stageId); await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "wx", 0o600); const hash = createHash("sha256"); let size = 0;
    try { for await (const chunk of chunks) { if (!(chunk instanceof Uint8Array)) throw new TypeError("INVALID_ARTIFACT_CHUNK"); size += chunk.byteLength;
      if (size > expectedSize || size > this.maximumBytes) throw new TypeError("ARTIFACT_TOO_LARGE"); hash.update(chunk); await handle.write(chunk); } await handle.sync(); }
    catch (error) { await handle.close(); await rm(path, { force: true }); throw error; } finally { await handle.close().catch(() => undefined); }
    if (size !== expectedSize || hash.digest("hex") !== expected.sha256) { await rm(path, { force: true }); throw new TypeError("ARTIFACT_DIGEST_MISMATCH"); }
    await writeFile(`${path}.json`, JSON.stringify({ expected, size, metadata }), { flag: "wx", mode: 0o600 });
    return Object.freeze({ stageId, expected, size, metadata });
  }
  async finalize(staged: StagedArtifact): Promise<DigestReference> {
    const path = this.stagePath(staged.stageId); const bytes = await readFile(path); if (bytes.byteLength !== staged.size || digestBytes(bytes) !== staged.expected.sha256) throw new TypeError("STAGED_ARTIFACT_TAMPERED");
    const destination = this.finalPath(staged.expected); await mkdir(dirname(destination), { recursive: true });
    try { await link(path, destination); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readFile(destination); if (digestBytes(current) !== staged.expected.sha256) throw new TypeError("CAS_COLLISION"); await rm(path, { force: true });
    }
    await rm(path, { force: true });
    await writeFile(`${destination}.json`, JSON.stringify({ ...staged.metadata, size: staged.size }), { flag: "wx", mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    await rm(`${path}.json`, { force: true }); return staged.expected;
  }
  async read(reference: DigestReference, grant: ArtifactReadGrant): Promise<Uint8Array> {
    digestReference(reference); const path = this.finalPath(reference); const metadata = JSON.parse(await readFile(`${path}.json`, "utf8"));
    if (metadata.tenantId !== grant.tenantId || metadata.repositoryId !== grant.repositoryId) throw new TypeError("ARTIFACT_NOT_FOUND"); const bytes = await readFile(path);
    if (digestBytes(bytes) !== reference.sha256) throw new TypeError("CAS_OBJECT_TAMPERED"); return bytes;
  }
  async exists(reference: DigestReference): Promise<boolean> { return stat(this.finalPath(reference)).then(() => true, () => false); }
  async delete(reference: DigestReference, token: ArtifactDeleteToken): Promise<void> {
    if (token.digest !== reference.sha256 || Date.parse(token.expiresAt) <= Date.now() || !token.intentId || token.fencingToken < 1) throw new TypeError("INVALID_DELETE_TOKEN");
    const metadata = JSON.parse(await readFile(`${this.finalPath(reference)}.json`, "utf8"));
    if (metadata.tenantId !== token.tenantId || metadata.repositoryId !== token.repositoryId) throw new TypeError("ARTIFACT_NOT_FOUND");
    await rm(this.finalPath(reference)); await rm(`${this.finalPath(reference)}.json`, { force: true });
  }
  private finalPath(reference: DigestReference): string { return join(this.root, "sha256", reference.sha256.slice(0, 2), reference.sha256); }
  private stagePath(stageId: string): string { if (!/^[a-f0-9-]{36}$/.test(stageId)) throw new TypeError("INVALID_STAGE_ID"); return join(this.root, "staging", stageId); }
}
