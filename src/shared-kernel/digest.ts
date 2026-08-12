import { createHash } from "node:crypto";

declare const digestBrand: unique symbol;
export type Sha256Digest = string & { readonly [digestBrand]: "Sha256Digest" };
export type CasUri = `cas://sha256/${Sha256Digest}`;
const SHA256 = /^[a-f0-9]{64}$/;

export function sha256Digest(value: string): Sha256Digest {
  if (!SHA256.test(value)) throw new TypeError("SHA-256 digest must be 64 lowercase hexadecimal characters");
  return value as Sha256Digest;
}

export function digestBytes(value: Uint8Array): Sha256Digest {
  return sha256Digest(createHash("sha256").update(value).digest("hex"));
}

export const casUri = (digest: Sha256Digest): CasUri => `cas://sha256/${digest}`;

export interface DigestReference {
  readonly uri: CasUri;
  readonly sha256: Sha256Digest;
}

export function digestReference(input: { uri: string; sha256: string }): Readonly<DigestReference> {
  const digest = sha256Digest(input.sha256);
  if (input.uri !== casUri(digest)) throw new TypeError("CAS URI and SHA-256 digest disagree");
  return Object.freeze({ uri: input.uri as CasUri, sha256: digest });
}

export function verifyDigest(reference: DigestReference, bytes: Uint8Array): void {
  if (digestBytes(bytes) !== reference.sha256) throw new TypeError("artifact digest verification failed");
}
