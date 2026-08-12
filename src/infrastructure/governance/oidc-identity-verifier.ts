import { createPublicKey, verify } from "node:crypto";
import { tenantId } from "../../shared-kernel/identity.js";
import type { IdentityVerifier, VerifiedIdentity } from "../../contexts/governance/application/identity.js";

export interface OidcSubjectMapping { readonly kind: "HUMAN" | "SERVICE"; readonly tenantId: string; readonly groups?: readonly string[]; readonly serviceAccount?: string; readonly requireMfa?: boolean; }
export interface OidcIssuerTrust { readonly issuer: string; readonly audiences: readonly string[]; readonly algorithms: readonly ["EdDSA", ..."EdDSA"[]];
  readonly keys: Readonly<Record<string, string>>; readonly subjects: Readonly<Record<string, OidcSubjectMapping>>; readonly maximumTokenAgeSeconds: number; readonly clockSkewSeconds: number; }
type Claims = { iss?: unknown; sub?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; iat?: unknown; amr?: unknown; acr?: unknown; email?: unknown };

export class CryptographicOidcIdentityVerifier implements IdentityVerifier {
  constructor(private readonly trusts: readonly OidcIssuerTrust[], private readonly now: () => number = () => Date.now()) {
    if (!trusts.length || trusts.some((trust) => !trust.issuer || !trust.audiences.length || !Object.keys(trust.keys).length || trust.maximumTokenAgeSeconds < 1 || trust.clockSkewSeconds < 0)) throw new TypeError("OIDC_TRUST_CONFIGURATION_REQUIRED");
  }
  async verify(token: string, expectedAudience: string): Promise<VerifiedIdentity> {
    if (token.length > 16_384) throw new TypeError("OIDC_TOKEN_TOO_LARGE"); const parts = token.split("."); if (parts.length !== 3) throw new TypeError("OIDC_TOKEN_MALFORMED");
    const header = json(parts[0]!, "OIDC_HEADER_INVALID") as { alg?: unknown; kid?: unknown; typ?: unknown }; const claims = json(parts[1]!, "OIDC_CLAIMS_INVALID") as Claims;
    if (header.alg !== "EdDSA" || typeof header.kid !== "string" || (header.typ !== undefined && header.typ !== "JWT")) throw new TypeError("OIDC_ALGORITHM_OR_KEY_REJECTED");
    const trust = this.trusts.find(({ issuer }) => issuer === claims.iss); if (!trust || !trust.algorithms.includes(header.alg)) throw new TypeError("OIDC_ISSUER_REJECTED");
    if (!trust.audiences.includes(expectedAudience) || !audiences(claims.aud).includes(expectedAudience)) throw new TypeError("OIDC_AUDIENCE_REJECTED");
    const publicKeyPem = trust.keys[header.kid]; if (!publicKeyPem) throw new TypeError("OIDC_KEY_REJECTED"); const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2]!, "base64url"))) throw new TypeError("OIDC_SIGNATURE_INVALID");
    const now = Math.floor(this.now() / 1000); const skew = trust.clockSkewSeconds; const exp = integer(claims.exp); const nbf = integer(claims.nbf); const iat = integer(claims.iat);
    if (exp < now - skew || nbf > now + skew || iat > now + skew || now - iat > trust.maximumTokenAgeSeconds + skew || exp <= iat) throw new TypeError("OIDC_TOKEN_TIME_REJECTED");
    if (typeof claims.sub !== "string") throw new TypeError("OIDC_SUBJECT_REJECTED"); const mapping = trust.subjects[claims.sub]; if (!mapping) throw new TypeError("OIDC_SUBJECT_REJECTED");
    const mfa = Array.isArray(claims.amr) && claims.amr.some((value) => value === "mfa" || value === "otp" || value === "hwk") || claims.acr === "urn:mace:incommon:iap:silver";
    if (mapping.kind === "HUMAN" && mapping.requireMfa !== false && !mfa) throw new TypeError("OIDC_MFA_REQUIRED");
    if (mapping.kind === "SERVICE" && (!mapping.serviceAccount || claims.email !== mapping.serviceAccount)) throw new TypeError("SERVICE_IDENTITY_MAPPING_REJECTED");
    return Object.freeze({ kind: mapping.kind, subject: claims.sub, tenantId: tenantId(mapping.tenantId), issuer: trust.issuer, audience: expectedAudience,
      groups: Object.freeze([...(mapping.groups ?? [])]), serviceAccount: mapping.kind === "SERVICE" ? mapping.serviceAccount! : null, mfa, expiresAt: new Date(exp * 1000).toISOString() });
  }
}
function json(value: string, reason: string): Record<string, unknown> { try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) throw new Error(); return parsed; } catch { throw new TypeError(reason); } }
function integer(value: unknown): number { if (!Number.isSafeInteger(value)) throw new TypeError("OIDC_TOKEN_TIME_REJECTED"); return value as number; }
function audiences(value: unknown): string[] { if (typeof value === "string") return [value]; if (Array.isArray(value) && value.length && value.every((item) => typeof item === "string")) return [...new Set(value)]; throw new TypeError("OIDC_AUDIENCE_REJECTED"); }
