import type { DigestReference } from "../../../shared-kernel/digest.js";
import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
import type { SigningPurpose } from "../domain/signing-purpose.js";

export type { SigningPurpose } from "../domain/signing-purpose.js";
export interface SigningRequest { readonly tenantId: TenantId; readonly repositoryId: RepositoryId; readonly environment: string;
  readonly purpose: SigningPurpose; readonly payloadDigest: DigestReference; readonly keyId: string; readonly correlationId: string; readonly deadline: string; }
export interface SigningResult { readonly keyId: string; readonly keyVersion: string; readonly algorithm: "ed25519"; readonly signature: string;
  readonly publicKey: string; readonly signedAt: string; }
/** Async production seam; Cloud KMS/HSM cannot implement Flywheel's synchronous Signer without lying. */
export interface PurposeBoundSigningPort { sign(request: SigningRequest): Promise<SigningResult>; }
