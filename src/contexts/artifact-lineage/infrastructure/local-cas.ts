import { link, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { digestBytes, digestReference, type DigestReference } from "../../../shared-kernel/digest.js";
import type { ArtifactAccessVerifier, ArtifactDeleteToken, ArtifactReadGrant, ArtifactWriteMetadata, ContentAddressedStoragePort, StagedArtifact } from "../application/cas-port.js";

export class LocalContentAddressedStorage implements ContentAddressedStoragePort {
  readonly root: string; readonly maximumBytes: number;
  constructor(root: string, maximumBytes = 256 * 1024 * 1024, readonly access: ArtifactAccessVerifier) { this.root = resolve(root); this.maximumBytes = maximumBytes; }
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
    return this.withDigestLock(staged.expected.sha256, async () => { const destination = this.finalPath(staged.expected); await mkdir(dirname(destination), { recursive: true });
    try { await link(path, destination); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readFile(destination); if (digestBytes(current) !== staged.expected.sha256) throw new TypeError("CAS_COLLISION"); await rm(path, { force: true });
    }
    await rm(path, { force: true });
    const metadataPath = `${destination}.json`; const scope = { tenantId: staged.metadata.tenantId, repositoryId: staged.metadata.repositoryId };
    await writeFile(metadataPath, JSON.stringify({ size: staged.size, scopes: [scope] }), { flag: "wx", mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error; const current = JSON.parse(await readFile(metadataPath, "utf8"));
      if (!current.scopes.some((item: typeof scope) => item.tenantId === scope.tenantId && item.repositoryId === scope.repositoryId)) {
        current.scopes.push(scope); await writeFile(metadataPath, JSON.stringify(current), { mode: 0o600 });
      }
    });
    await rm(`${path}.json`, { force: true }); return staged.expected; });
  }
  async read(reference: DigestReference, grant: ArtifactReadGrant): Promise<Uint8Array> {
    const verified = await this.access.verifyRead(grant); digestReference(reference); const path = this.finalPath(reference); const metadata = JSON.parse(await readFile(`${path}.json`, "utf8"));
    if (!metadata.scopes?.some((item: { tenantId: string; repositoryId: string }) => item.tenantId === verified.tenantId && item.repositoryId === verified.repositoryId)) throw new TypeError("ARTIFACT_NOT_FOUND"); const bytes = await readFile(path);
    if (digestBytes(bytes) !== reference.sha256) throw new TypeError("CAS_OBJECT_TAMPERED"); return bytes;
  }
  async exists(reference: DigestReference): Promise<boolean> { return stat(this.finalPath(reference)).then(() => true, () => false); }
  async delete(reference: DigestReference, token: ArtifactDeleteToken): Promise<void> {
    const verified = await this.access.verifyDelete(token); if (verified.digest !== reference.sha256) throw new TypeError("INVALID_DELETE_TOKEN");
    return this.withDigestLock(reference.sha256, async () => { const metadataText = await readFile(`${this.finalPath(reference)}.json`, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined; throw error;
    });
    if (metadataText === undefined && !await this.exists(reference)) return;
    if (metadataText === undefined) throw new TypeError("CAS_METADATA_MISSING");
    const metadata = JSON.parse(metadataText);
    if (!metadata.scopes?.some((item: { tenantId: string; repositoryId: string }) => item.tenantId === verified.tenantId && item.repositoryId === verified.repositoryId)) throw new TypeError("ARTIFACT_NOT_FOUND");
    await rm(this.finalPath(reference)); await rm(`${this.finalPath(reference)}.json`, { force: true }); });
  }
  private async withDigestLock<T>(digest: string, operation: () => Promise<T>): Promise<T> {
    const path = join(this.root, "locks", digest); await mkdir(dirname(path), { recursive: true }); let handle; const ownerStart = await processStart(process.pid); const ownerId = randomUUID();
    for (let attempt = 0; attempt < 400; attempt++) try { handle = await open(path, "wx", 0o600); await handle.writeFile(JSON.stringify({ ownerId, pid: process.pid, start: ownerStart, expiresAt: Date.now() + 30_000 })); await handle.sync(); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 399) throw error;
      const lease = await readFile(path, "utf8").then((value) => JSON.parse(value), () => undefined);
      if (lease && lease.expiresAt <= Date.now() && !await processOwnerAlive(lease.pid, lease.start)) {
        await recoverStaleLease(path, lease.ownerId);
      } else await new Promise((resolve) => setTimeout(resolve, 5)); }
    try { return await operation(); } finally { await handle?.close(); const current = await readFile(path, "utf8").then((value) => JSON.parse(value), () => undefined);
      if (current?.ownerId === ownerId) await rm(path, { force: true }); }
  }
  private finalPath(reference: DigestReference): string { return join(this.root, "sha256", reference.sha256.slice(0, 2), reference.sha256); }
  private stagePath(stageId: string): string { if (!/^[a-f0-9-]{36}$/.test(stageId)) throw new TypeError("INVALID_STAGE_ID"); return join(this.root, "staging", stageId); }
}
async function processStart(pid: number): Promise<string> {
  return readFile(`/proc/${pid}/stat`, "utf8").then((value) => value.split(" ")[21] ?? "unknown", () => "unknown");
}
async function processOwnerAlive(pid: number, start: string): Promise<boolean> {
  try { process.kill(pid, 0); return await processStart(pid) === start; } catch { return false; }
}
async function recoverStaleLease(path: string, expectedOwner: string): Promise<void> {
  const recovery = `${path}.recovery`; let guard;
  try { guard = await open(recovery, "wx", 0o600); await guard.writeFile(expectedOwner); const current = await readFile(path, "utf8").then((value) => JSON.parse(value), () => undefined);
    if (current?.ownerId === expectedOwner && current.expiresAt <= Date.now() && !await processOwnerAlive(current.pid, current.start)) await rm(path, { force: true });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  finally { await guard?.close(); if (guard) await rm(recovery, { force: true }); }
}
