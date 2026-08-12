import { createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { canon, type PromotionReceipt, type Signer } from "@metaharness/flywheel";

/** Exact synchronous Flywheel Signer adapter for explicitly configured development/test use only. */
export class LocalFlywheelSigner implements Signer {
  readonly #privateKey; readonly #publicKey: string;
  constructor(privateKeyPem: string) {
    this.#privateKey = createPrivateKey(privateKeyPem); if (this.#privateKey.asymmetricKeyType !== "ed25519") throw new TypeError("ED25519_KEY_REQUIRED");
    this.#publicKey = createPublicKey(this.#privateKey).export({ type: "spki", format: "der" }).toString("base64"); Object.freeze(this);
  }
  publicKey(): string { return this.#publicKey; }
  sign(payload: Record<string, unknown>): PromotionReceipt {
    return { payload, signature: edSign(null, Buffer.from(canon(payload)), this.#privateKey).toString("base64"), publicKey: this.#publicKey, alg: "ed25519" };
  }
}
