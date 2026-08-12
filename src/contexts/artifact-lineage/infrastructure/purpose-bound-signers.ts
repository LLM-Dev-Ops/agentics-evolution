import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { PurposeBoundSigningPort, SigningRequest, SigningResult } from "../application/signing-port.js";

export interface RemoteAsymmetricSigningProvider {
  readonly provider: "cloud-kms" | "hsm";
  signEd25519(keyVersion: string, digest: Uint8Array, signal: AbortSignal): Promise<{ readonly signature: Uint8Array; readonly publicKey: string }>;
}
export interface SigningCapability {
  allows(request: SigningRequest): boolean;
}

abstract class BoundSigner implements PurposeBoundSigningPort {
  constructor(protected readonly capability: SigningCapability) {}
  async sign(request: SigningRequest): Promise<SigningResult> {
    if (!this.capability.allows(request)) throw new TypeError("SIGNING_CAPABILITY_DENIED");
    const deadline = Date.parse(request.deadline);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new TypeError("SIGNING_DEADLINE_EXPIRED");
    return this.signAuthorized(request, AbortSignal.timeout(deadline - Date.now()));
  }
  protected abstract signAuthorized(request: SigningRequest, signal: AbortSignal): Promise<SigningResult>;
}

/** Async development signer. It intentionally does not implement Flywheel's synchronous Signer. */
export class LocalPurposeBoundSigner extends BoundSigner {
  readonly #privateKey;
  readonly #publicKey: string;
  constructor(privateKeyPem: string, capability: SigningCapability, readonly keyVersion: string) {
    super(capability);
    this.#privateKey = createPrivateKey(privateKeyPem);
    if (this.#privateKey.asymmetricKeyType !== "ed25519") throw new TypeError("ED25519_KEY_REQUIRED");
    this.#publicKey = createPublicKey(this.#privateKey).export({ type: "spki", format: "der" }).toString("base64");
  }
  protected async signAuthorized(request: SigningRequest, signal: AbortSignal): Promise<SigningResult> {
    signal.throwIfAborted();
    const signature = sign(null, Buffer.from(request.payloadDigest.sha256, "hex"), this.#privateKey).toString("base64");
    signal.throwIfAborted();
    return Object.freeze({ keyId: request.keyId, keyVersion: this.keyVersion, algorithm: "ed25519", signature,
      publicKey: this.#publicKey, signedAt: new Date().toISOString() });
  }
}

/** Honest async KMS/HSM seam: construction requires a real provider; no local fallback exists. */
export class RemotePurposeBoundSigner extends BoundSigner {
  constructor(private readonly provider: RemoteAsymmetricSigningProvider | undefined, capability: SigningCapability, readonly keyVersion: string) {
    super(capability);
  }
  protected async signAuthorized(request: SigningRequest, signal: AbortSignal): Promise<SigningResult> {
    if (!this.provider) throw new Error("PRODUCTION_SIGNING_PROVIDER_UNAVAILABLE");
    const result = await this.provider.signEd25519(this.keyVersion, Buffer.from(request.payloadDigest.sha256, "hex"), signal);
    if (!(result.signature instanceof Uint8Array) || !result.signature.byteLength || !result.publicKey) throw new Error("INVALID_PRODUCTION_SIGNER_RESPONSE");
    return Object.freeze({ keyId: request.keyId, keyVersion: this.keyVersion, algorithm: "ed25519",
      signature: Buffer.from(result.signature).toString("base64"), publicKey: result.publicKey, signedAt: new Date().toISOString() });
  }
}
