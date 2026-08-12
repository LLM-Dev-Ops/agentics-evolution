export interface LegalHoldAuthorization {
  readonly receipt: string;
}
export interface VerifiedLegalHoldAuthorization {
  readonly tenantId: string;
  readonly manifestDigest: string;
  readonly action: "PLACE" | "RELEASE";
  readonly actor: string;
  readonly expiresAt: string;
  readonly nonce: string;
}
export interface LegalHoldAuthorizationVerifier {
  verify(authorization: LegalHoldAuthorization): Promise<VerifiedLegalHoldAuthorization>;
}
