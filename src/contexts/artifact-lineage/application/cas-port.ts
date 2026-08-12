import type { DigestReference } from "../../../shared-kernel/digest.js";
import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { ArtifactClassification, RetentionClass } from "../domain/artifact-manifest.js";

export interface ArtifactWriteMetadata { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly mediaType: string;
  readonly classification: ArtifactClassification; readonly retention: RetentionClass; readonly legalHold: boolean; }
export interface StagedArtifact { readonly stageId: string; readonly expected: DigestReference; readonly size: number; readonly metadata: ArtifactWriteMetadata; }
export interface ContentAddressedStoragePort {
  stage(bytes: Uint8Array, expected: DigestReference, metadata: ArtifactWriteMetadata): Promise<StagedArtifact>;
  finalize(staged: StagedArtifact): Promise<DigestReference>;
  read(reference: DigestReference, tenantId: TenantId): Promise<Uint8Array>;
  exists(reference: DigestReference): Promise<boolean>;
  delete(reference: DigestReference): Promise<void>;
}
