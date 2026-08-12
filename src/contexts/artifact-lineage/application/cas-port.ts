import type { DigestReference } from "../../../shared-kernel/digest.js";
import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { ArtifactClassification, RetentionClass } from "../domain/artifact-manifest.js";

export interface ArtifactWriteMetadata { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly mediaType: string;
  readonly classification: ArtifactClassification; readonly retention: RetentionClass; readonly legalHold: boolean; }
export interface StagedArtifact { readonly stageId: string; readonly expected: DigestReference; readonly size: number; readonly metadata: ArtifactWriteMetadata; }
const grantBrand: unique symbol = Symbol("artifact-grant");
export interface ArtifactReadGrant { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly [grantBrand]: "read"; }
export interface ArtifactDeleteToken { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly digest: string;
  readonly intentId: string; readonly expiresAt: string; readonly fencingToken: number; readonly [grantBrand]: "delete"; }
export const artifactReadGrant = (tenantId: TenantId, repositoryId: RepositoryId): ArtifactReadGrant =>
  Object.freeze({ tenantId, repositoryId, [grantBrand]: "read" as const });
/** Mint only after a durable, fenced delete intent has committed. */
export const artifactDeleteToken = (value: Omit<ArtifactDeleteToken, typeof grantBrand>): ArtifactDeleteToken =>
  Object.freeze({ ...value, [grantBrand]: "delete" as const });
export interface ContentAddressedStoragePort {
  stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact>;
  stageStream(chunks: AsyncIterable<Uint8Array>, expected: DigestReference, expectedSize: number, metadata: ArtifactWriteMetadata): Promise<StagedArtifact>;
  finalize(staged: StagedArtifact): Promise<DigestReference>;
  read(reference: DigestReference, grant: ArtifactReadGrant): Promise<Uint8Array>;
  exists(reference: DigestReference): Promise<boolean>;
  delete(reference: DigestReference, token: ArtifactDeleteToken): Promise<void>;
}
