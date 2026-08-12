import { createHmac, timingSafeEqual } from "node:crypto";
import type { ArtifactAccessAuthority, ArtifactDeleteToken, ArtifactReadGrant, VerifiedArtifactDeleteToken, VerifiedArtifactReadGrant } from "../../contexts/artifact-lineage/application/cas-port.js";
import { repositoryId, tenantId } from "../../shared-kernel/identity.js";

export class HmacArtifactAccessAuthority implements ArtifactAccessAuthority {
  constructor(private readonly secret: Uint8Array) { if (secret.byteLength < 32) throw new TypeError("ACCESS_AUTHORITY_SECRET_TOO_SHORT"); }
  issueRead(value: VerifiedArtifactReadGrant): ArtifactReadGrant { return { receipt: this.seal({ ...value, action: "READ" }) }; }
  issueDelete(value: VerifiedArtifactDeleteToken): ArtifactDeleteToken { return { receipt: this.seal({ ...value, action: "DELETE" }) }; }
  async verifyRead(grant: ArtifactReadGrant): Promise<VerifiedArtifactReadGrant> { const value = this.open(grant.receipt, "READ"); return this.read(value); }
  async verifyDelete(token: ArtifactDeleteToken): Promise<VerifiedArtifactDeleteToken> {
    const value = this.open(token.receipt, "DELETE"); const read = this.read(value);
    if (!/^[a-f0-9]{64}$/.test(String(value.digest)) || !value.intentId || !Number.isSafeInteger(value.fencingToken) || Number(value.fencingToken) < 1) throw new TypeError("INVALID_DELETE_TOKEN");
    return { ...read, digest: String(value.digest), intentId: String(value.intentId), fencingToken: Number(value.fencingToken) };
  }
  private read(value: Record<string, unknown>): VerifiedArtifactReadGrant {
    if (Date.parse(String(value.expiresAt)) <= Date.now()) throw new TypeError("ARTIFACT_ACCESS_EXPIRED");
    return { tenantId: tenantId(String(value.tenantId)), repositoryId: repositoryId(String(value.repositoryId)), expiresAt: String(value.expiresAt) };
  }
  private seal(value: object): string { const payload = Buffer.from(JSON.stringify(value)).toString("base64url"); return `${payload}.${createHmac("sha256", this.secret).update(payload).digest("base64url")}`; }
  private open(receipt: string, action: string): Record<string, unknown> {
    const [payload, signature] = receipt.split("."); if (!payload || !signature) throw new TypeError("INVALID_ARTIFACT_ACCESS_RECEIPT");
    const expected = createHmac("sha256", this.secret).update(payload).digest(); const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new TypeError("INVALID_ARTIFACT_ACCESS_SIGNATURE");
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>; if (value.action !== action) throw new TypeError("ARTIFACT_ACCESS_ACTION_MISMATCH"); return value;
  }
}
