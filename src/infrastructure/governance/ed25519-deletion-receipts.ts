import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { DeletionReceiptPayload, DeletionReceiptSigner, SignedDeletionReceipt } from "../../contexts/governance/application/privacy-boundaries.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";

export class Ed25519DeletionReceiptSigner implements DeletionReceiptSigner {
  private readonly key; constructor(private readonly keyId: string, privateKeyPem: string) { this.key = createPrivateKey(privateKeyPem); if (!keyId || this.key.asymmetricKeyType !== "ed25519") throw new TypeError("DELETION_SIGNING_KEY_INVALID"); }
  async sign(payload: DeletionReceiptPayload): Promise<SignedDeletionReceipt> { return Object.freeze({ payload, keyId: this.keyId, signature: sign(null, Buffer.from(canonicalJson(payload)), this.key).toString("base64") }); }
}
export class Ed25519DeletionReceiptVerifier {
  constructor(private readonly keys: Readonly<Record<string, string>>) { if (!Object.keys(keys).length) throw new TypeError("DELETION_TRUST_ROOT_REQUIRED"); }
  verify(receipt: SignedDeletionReceipt): boolean { const pem = this.keys[receipt.keyId]; if (!pem) return false; const key = createPublicKey(pem); return key.asymmetricKeyType === "ed25519" && verify(null, Buffer.from(canonicalJson(receipt.payload)), key, Buffer.from(receipt.signature, "base64")); }
}
