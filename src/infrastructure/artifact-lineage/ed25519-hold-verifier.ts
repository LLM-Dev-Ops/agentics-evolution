import { createPublicKey, verify } from "node:crypto";
import type { LegalHoldAuthorization, LegalHoldAuthorizationVerifier, VerifiedLegalHoldAuthorization } from "../../contexts/artifact-lineage/application/legal-hold-authorization.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";

interface SignedHoldReceipt { readonly payload: VerifiedLegalHoldAuthorization; readonly signature: string; readonly algorithm: "ed25519"; readonly keyId: string; }

/** Verifies opaque governance receipts against separately configured trust anchors. */
export class Ed25519LegalHoldAuthorizationVerifier implements LegalHoldAuthorizationVerifier {
  readonly #keys: ReadonlyMap<string, ReturnType<typeof createPublicKey>>;
  constructor(publicKeys: Readonly<Record<string, string>>) {
    this.#keys = new Map(Object.entries(publicKeys).map(([id, pem]) => [id, createPublicKey(pem)]));
  }
  async verify(authorization: LegalHoldAuthorization): Promise<VerifiedLegalHoldAuthorization> {
    let receipt: SignedHoldReceipt;
    try { receipt = JSON.parse(Buffer.from(authorization.receipt, "base64url").toString("utf8")) as SignedHoldReceipt; }
    catch { throw new TypeError("INVALID_LEGAL_HOLD_RECEIPT"); }
    const key = this.#keys.get(receipt.keyId);
    if (!key || receipt.algorithm !== "ed25519" || !verify(null, Buffer.from(canonicalJson(receipt.payload)), key, Buffer.from(receipt.signature, "base64")))
      throw new TypeError("INVALID_LEGAL_HOLD_SIGNATURE");
    if (!receipt.payload.nonce || !/^[a-f0-9]{64}$/.test(receipt.payload.manifestDigest)) throw new TypeError("INVALID_LEGAL_HOLD_SCOPE");
    return Object.freeze({ ...receipt.payload });
  }
}
