import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRvfStore, isNativeAvailable, isRvfAvailable, openRvfStore,
  rvfClose, rvfIngest, rvfQuery, rvfStatus
} from "ruvector";
import type { RvfWitnessBundle, RvfWitnessPort, RvfVectorEntry } from "../../contexts/artifact-lineage/application/rvf-witness-port.js";
import type { RvfWitness } from "../../contexts/artifact-lineage/domain/artifact-manifest.js";
import { digestBytes, digestReference, type DigestReference } from "../../shared-kernel/digest.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";

const FORMAT_VERSION = "ruvector@0.2.41/rvf@0.2.3";

export class NativeRvfWitnessAdapter implements RvfWitnessPort {
  async create(entries: readonly RvfVectorEntry[], orderedContent: readonly DigestReference[]): Promise<RvfWitnessBundle> {
    const dimensions = validateEntries(entries);
    requireNativeRvf();
    const directory = await mkdtemp(join(tmpdir(), "agentics-rvf-create-"));
    const path = join(directory, "witness.rvf");
    let store: unknown;
    try {
      store = await createRvfStore(path, { dimensions, metric: "cosine" });
      const result = await rvfIngest(store, entries.map(toUpstreamEntry));
      if (result.accepted !== entries.length || result.rejected !== 0) throw new Error("RVF_INGEST_INCOMPLETE");
      await rvfClose(store); store = undefined;
      const rvfBytes = await readFile(path);
      const identityMapBytes = await readFile(`${path}.idmap.json`);
      const witness = makeWitness(rvfBytes, identityMapBytes, orderedContent);
      const bundle = Object.freeze({
        witness,
        rvfBytes,
        identityMapBytes,
        vectorCount: entries.length,
        dimensions,
        entryIds: Object.freeze(entries.map(({ id }) => id))
      });
      await this.verify(bundle, orderedContent);
      return bundle;
    } finally {
      if (store) await rvfClose(store).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }

  async verify(bundle: RvfWitnessBundle, orderedContent: readonly DigestReference[]): Promise<void> {
    requireNativeRvf();
    const expected = makeWitness(bundle.rvfBytes, bundle.identityMapBytes, orderedContent);
    if (canonicalJson(expected) !== canonicalJson(bundle.witness)) throw new Error("RVF_WITNESS_MISMATCH");
    const directory = await mkdtemp(join(tmpdir(), "agentics-rvf-verify-"));
    const path = join(directory, "witness.rvf");
    let store: unknown;
    try {
      await writeFile(path, bundle.rvfBytes, { flag: "wx", mode: 0o600 });
      await writeFile(`${path}.idmap.json`, bundle.identityMapBytes, { flag: "wx", mode: 0o600 });
      store = await openRvfStore(path);
      const status = await rvfStatus(store);
      if (status.totalVectors !== bundle.vectorCount) throw new Error("RVF_VECTOR_COUNT_MISMATCH");
      const probe = new Array<number>(bundle.dimensions).fill(0); probe[0] = 1;
      const results = await rvfQuery(store, probe, Math.min(1, bundle.vectorCount));
      if (bundle.vectorCount > 0 && results.length !== 1) throw new Error("RVF_QUERY_VERIFICATION_FAILED");
      if (results[0] && !bundle.entryIds.includes(results[0].id)) throw new Error("RVF_IDENTITY_MAP_INVALID");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("RVF_")) throw error;
      throw new Error("RVF_CONTAINER_INVALID", { cause: error });
    } finally {
      if (store) await rvfClose(store).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function requireNativeRvf(): void {
  if (!isNativeAvailable() || !isRvfAvailable()) throw new Error("RVF_NATIVE_CAPABILITY_UNAVAILABLE");
}
function validateEntries(entries: readonly RvfVectorEntry[]): number {
  if (entries.length === 0) throw new TypeError("RVF_ENTRIES_REQUIRED");
  const dimensions = entries[0]?.vector.length ?? 0;
  if (dimensions === 0 || entries.some((entry) => !entry.id || entry.vector.length !== dimensions || entry.vector.some((value) => !Number.isFinite(value))))
    throw new TypeError("RVF_ENTRY_INVALID");
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new TypeError("RVF_ENTRY_ID_DUPLICATE");
  return dimensions;
}
function toUpstreamEntry(entry: RvfVectorEntry): { id: string; vector: number[]; metadata?: Record<string, string | number | boolean> } {
  return entry.metadata ? { id: entry.id, vector: [...entry.vector], metadata: { ...entry.metadata } } : { id: entry.id, vector: [...entry.vector] };
}
function makeWitness(rvfBytes: Uint8Array, identityMapBytes: Uint8Array, orderedContent: readonly DigestReference[]): RvfWitness {
  const rvfSha = digestBytes(rvfBytes);
  const contentBytes = new TextEncoder().encode(canonicalJson({
    rvfSha256: rvfSha,
    identityMapSha256: digestBytes(identityMapBytes),
    orderedContent: orderedContent.map((item) => ({ uri: item.uri, sha256: item.sha256 }))
  }));
  const contentSha = digestBytes(contentBytes);
  return Object.freeze({
    rvfDigest: digestReference({ uri: `cas://sha256/${rvfSha}`, sha256: rvfSha }),
    contentSetDigest: digestReference({ uri: `cas://sha256/${contentSha}`, sha256: contentSha }),
    format: "ruvector-rvf",
    formatVersion: FORMAT_VERSION
  });
}
