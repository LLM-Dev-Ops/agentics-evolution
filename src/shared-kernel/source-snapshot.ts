import { DigestReference, digestReference } from "./digest.js";

export type ObjectFormat = "sha1" | "sha256";
export type CommitId = string & { readonly __commitId: unique symbol };
export interface SourceSnapshot { readonly objectFormat: ObjectFormat; readonly commit: CommitId; readonly dirtySnapshot: DigestReference | null; }

export function commitId(value: string, objectFormat: ObjectFormat): CommitId {
  const length = objectFormat === "sha1" ? 40 : 64;
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw new TypeError(`commit must match repository ${objectFormat} object format`);
  return value as CommitId;
}

export function sourceSnapshot(input: { objectFormat?: ObjectFormat; commit: string; dirtySnapshot: { uri: string; sha256: string } | null }): Readonly<SourceSnapshot> {
  const objectFormat = input.objectFormat ?? (input.commit.length === 40 ? "sha1" : "sha256");
  return Object.freeze({ objectFormat, commit: commitId(input.commit, objectFormat), dirtySnapshot: input.dirtySnapshot ? digestReference(input.dirtySnapshot) : null });
}
