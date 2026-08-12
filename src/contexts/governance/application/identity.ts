import type { TenantId } from "../../../shared-kernel/identity.js";

export type IdentityKind = "HUMAN" | "SERVICE";
export interface VerifiedIdentity { readonly kind: IdentityKind; readonly subject: string; readonly tenantId: TenantId; readonly issuer: string;
  readonly audience: string; readonly groups: readonly string[]; readonly serviceAccount: string | null; readonly mfa: boolean; readonly expiresAt: string; }
export interface IdentityVerifier { verify(token: string, expectedAudience: string): Promise<VerifiedIdentity>; }
