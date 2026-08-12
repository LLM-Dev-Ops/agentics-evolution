import type { DigestReference } from "../../../shared-kernel/digest.js";
import type { RvfWitness } from "../domain/artifact-manifest.js";

export interface RvfVectorEntry {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RvfWitnessBundle {
  readonly witness: RvfWitness;
  readonly rvfBytes: Uint8Array;
  readonly identityMapBytes: Uint8Array;
  readonly vectorCount: number;
  readonly dimensions: number;
  /** Logical identities expected to survive the native RVF identity-map round trip. */
  readonly entryIds: readonly string[];
}

export interface RvfWitnessPort {
  create(entries: readonly RvfVectorEntry[], orderedContent: readonly DigestReference[]): Promise<RvfWitnessBundle>;
  verify(bundle: RvfWitnessBundle, orderedContent: readonly DigestReference[]): Promise<void>;
}
