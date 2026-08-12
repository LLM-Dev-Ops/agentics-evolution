import { digestBytes, digestReference, type DigestReference } from "../../../shared-kernel/digest.js";
import { canonicalJson, deepFreeze } from "../../../shared-kernel/immutable.js";
import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { SourceSnapshot } from "../../../shared-kernel/source-snapshot.js";

export type ArtifactStatus = "STAGED" | "SEALED" | "REVOKED" | "EXPIRED";
export type RetentionClass = "OPERATIONAL_SCRATCH" | "CANDIDATE_ARCHIVE" | "EVALUATION_EVIDENCE" | "AUTHORIZATION_AUDIT" | "LEGAL_HOLD";
export type ArtifactClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
export interface ArtifactDependency { readonly digest: DigestReference; readonly role: string; }
export interface RvfWitness { readonly rvfDigest: DigestReference; readonly contentSetDigest: DigestReference; readonly format: "ruvector-rvf"; readonly formatVersion: string; }
export interface ArtifactManifestPayload { readonly schema: "agentics.artifact-manifest/v1"; readonly tenantId: TenantId; readonly repositoryId: RepositoryId;
  readonly artifact: DigestReference; readonly mediaType: string; readonly size: number; readonly producer: string; readonly source: SourceSnapshot;
  readonly dependencies: readonly ArtifactDependency[]; readonly classification: ArtifactClassification; readonly retention: RetentionClass;
  readonly createdAt: string; readonly rvfWitness: RvfWitness | null; }
export interface ArtifactManifest { readonly payload: ArtifactManifestPayload; readonly manifestDigest: DigestReference; readonly status: ArtifactStatus;
  readonly keyId: string | null; readonly signature: string | null; readonly algorithm: "ed25519" | null; }

export function canonicalManifestBytes(payload: ArtifactManifestPayload): Uint8Array {
  validatePayload(payload); return new TextEncoder().encode(canonicalJson(payload));
}
export function stagedManifest(payload: ArtifactManifestPayload): ArtifactManifest {
  const bytes = canonicalManifestBytes(payload); const sha256 = digestBytes(bytes);
  return deepFreeze({ payload, manifestDigest: digestReference({ uri: `cas://sha256/${sha256}`, sha256 }), status: "STAGED", keyId: null, signature: null, algorithm: null });
}
export function sealedManifest(staged: ArtifactManifest, keyId: string, signature: string): ArtifactManifest {
  if (staged.status !== "STAGED" || !keyId || !/^[A-Za-z0-9._:/-]{1,256}$/.test(keyId) || !signature) throw new TypeError("INVALID_MANIFEST_SEAL");
  return deepFreeze({ ...staged, status: "SEALED", keyId, signature, algorithm: "ed25519" });
}
function validatePayload(value: ArtifactManifestPayload): void {
  if (value.schema !== "agentics.artifact-manifest/v1" || !value.mediaType || !value.producer || !Number.isSafeInteger(value.size) || value.size < 0) throw new TypeError("INVALID_ARTIFACT_MANIFEST");
  digestReference(value.artifact); const seen = new Set();
  for (const dependency of value.dependencies) { digestReference(dependency.digest); if (!dependency.role || seen.has(dependency.digest.sha256)) throw new TypeError("INVALID_OR_DUPLICATE_DEPENDENCY"); seen.add(dependency.digest.sha256); }
  if (value.rvfWitness) { digestReference(value.rvfWitness.rvfDigest); digestReference(value.rvfWitness.contentSetDigest); if (value.rvfWitness.format !== "ruvector-rvf") throw new TypeError("INVALID_RVF_WITNESS"); }
}
