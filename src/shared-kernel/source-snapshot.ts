import { DigestReference, digestReference } from "./digest.js";

export type CommitId = string & { readonly __commitId: unique symbol };
export interface SourceSnapshot { readonly commit: CommitId; readonly dirtySnapshot: DigestReference | null; }

export function commitId(value: string): CommitId {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new TypeError("commit must be a canonical SHA-1 or SHA-256 object ID");
  return value as CommitId;
}

export function sourceSnapshot(input: { commit: string; dirtySnapshot: { uri: string; sha256: string } | null }): Readonly<SourceSnapshot> {
  return Object.freeze({ commit: commitId(input.commit), dirtySnapshot: input.dirtySnapshot ? digestReference(input.dirtySnapshot) : null });
}
