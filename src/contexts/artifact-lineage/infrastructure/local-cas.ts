import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { digestBytes, digestReference, type DigestReference } from "../../../shared-kernel/digest.js";
import type { TenantId } from "../../../shared-kernel/identity.js";
import type { ArtifactWriteMetadata, ContentAddressedStoragePort, StagedArtifact } from "../application/cas-port.js";

export class LocalContentAddressedStorage implements ContentAddressedStoragePort {
  readonly root: string; readonly maximumBytes: number;
  constructor(root: string, maximumBytes = 256 * 1024 * 1024) { this.root = resolve(root); this.maximumBytes = maximumBytes; }
  async stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact> {
    digestReference(expected); if (bytes.byteLength > this.maximumBytes) throw new TypeError("ARTIFACT_TOO_LARGE");
    if (digestBytes(bytes) !== expected.sha256) throw new TypeError("ARTIFACT_DIGEST_MISMATCH");
    const stageId = randomUUID(); const path = this.stagePath(stageId); await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "wx", 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await writeFile(`${path}.json`, JSON.stringify({ expected, size: bytes.byteLength, metadata }), { flag: "wx", mode: 0o600 });
    return Object.freeze({ stageId, expected, size: bytes.byteLength, metadata });
  }
  async finalize(staged: StagedArtifact): Promise<DigestReference> {
    const path = this.stagePath(staged.stageId); const bytes = await readFile(path); if (bytes.byteLength !== staged.size || digestBytes(bytes) !== staged.expected.sha256) throw new TypeError("STAGED_ARTIFACT_TAMPERED");
    const destination = this.finalPath(staged.expected); await mkdir(dirname(destination), { recursive: true });
    try { await rename(path, destination); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readFile(destination); if (digestBytes(current) !== staged.expected.sha256) throw new TypeError("CAS_COLLISION"); await rm(path, { force: true });
    }
    await writeFile(`${destination}.json`, JSON.stringify({ ...staged.metadata, size: staged.size }), { flag: "wx", mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    await rm(`${path}.json`, { force: true }); return staged.expected;
  }
  async read(reference: DigestReference, tenantId: TenantId): Promise<Uint8Array> {
    digestReference(reference); const path = this.finalPath(reference); const metadata = JSON.parse(await readFile(`${path}.json`, "utf8"));
    if (metadata.tenantId !== tenantId) throw new TypeError("ARTIFACT_NOT_FOUND"); const bytes = await readFile(path);
    if (digestBytes(bytes) !== reference.sha256) throw new TypeError("CAS_OBJECT_TAMPERED"); return bytes;
  }
  async exists(reference: DigestReference): Promise<boolean> { return stat(this.finalPath(reference)).then(() => true, () => false); }
  async delete(reference: DigestReference): Promise<void> { await rm(this.finalPath(reference)); await rm(`${this.finalPath(reference)}.json`, { force: true }); }
  private finalPath(reference: DigestReference): string { return join(this.root, "sha256", reference.sha256.slice(0, 2), reference.sha256); }
  private stagePath(stageId: string): string { if (!/^[a-f0-9-]{36}$/.test(stageId)) throw new TypeError("INVALID_STAGE_ID"); return join(this.root, "staging", stageId); }
}
