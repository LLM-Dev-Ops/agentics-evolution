import type { DigestReference } from "../../../shared-kernel/digest.js";
import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { ArtifactClassification, RetentionClass } from "../domain/artifact-manifest.js";

export interface ArtifactWriteMetadata { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly mediaType: string;
  readonly classification: ArtifactClassification; readonly retention: RetentionClass; readonly legalHold: boolean; }
export interface StagedArtifact { readonly stageId: string; readonly expected: DigestReference; readonly size: number; readonly metadata: ArtifactWriteMetadata; }
export interface ArtifactReadGrant { readonly receipt: string; }
export interface ArtifactDeleteToken { readonly receipt: string; }
export interface VerifiedArtifactReadGrant { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly expiresAt: string; }
export interface VerifiedArtifactDeleteToken extends VerifiedArtifactReadGrant { readonly digest: string; readonly intentId: string; readonly fencingToken: number; }
export interface ArtifactAccessVerifier {
  verifyRead(grant: ArtifactReadGrant): Promise<VerifiedArtifactReadGrant>;
  verifyDelete(token: ArtifactDeleteToken): Promise<VerifiedArtifactDeleteToken>;
}
export interface ArtifactAccessAuthority extends ArtifactAccessVerifier {
  issueRead(value: VerifiedArtifactReadGrant): ArtifactReadGrant;
  issueDelete(value: VerifiedArtifactDeleteToken): ArtifactDeleteToken;
}
export interface ContentAddressedStoragePort {
  stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact>;
  stageStream(chunks: AsyncIterable<Uint8Array>, expected: DigestReference, expectedSize: number, metadata: ArtifactWriteMetadata): Promise<StagedArtifact>;
  finalize(staged: StagedArtifact): Promise<DigestReference>;
  read(reference: DigestReference, grant: ArtifactReadGrant): Promise<Uint8Array>;
  exists(reference: DigestReference): Promise<boolean>;
  delete(reference: DigestReference, token: ArtifactDeleteToken): Promise<void>;
}
