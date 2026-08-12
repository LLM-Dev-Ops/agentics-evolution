import { KeyManagementServiceClient } from "@google-cloud/kms";
import { createPublicKey, verify } from "node:crypto";
import type { RemoteAsymmetricSigningProvider } from "../../contexts/artifact-lineage/infrastructure/purpose-bound-signers.js";

const VERSION_NAME = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[1-9][0-9]*$/;

/** Real Google Cloud KMS Ed25519 provider. It never substitutes a local key. */
export class CloudKmsEd25519Provider implements RemoteAsymmetricSigningProvider {
  readonly provider = "cloud-kms" as const;
  constructor(private readonly client: KeyManagementServiceClient = new KeyManagementServiceClient()) {}

  async signEd25519(keyVersion: string, digest: Uint8Array, signal: AbortSignal): Promise<{ signature: Uint8Array; publicKey: string }> {
    if (!VERSION_NAME.test(keyVersion)) throw new TypeError("KMS_KEY_VERSION_REQUIRED");
    if (digest.byteLength !== 32) throw new TypeError("KMS_SHA256_DIGEST_REQUIRED");
    signal.throwIfAborted();
    const timeout = abortableTimeout(signal);
    const [publicResponse, signResponse] = await Promise.all([
      this.client.getPublicKey({ name: keyVersion }, { timeout }),
      this.client.asymmetricSign({ name: keyVersion, data: Buffer.from(digest) }, { timeout })
    ]);
    signal.throwIfAborted();
    const publicKey = publicResponse[0];
    const signed = signResponse[0];
    if (publicKey.name !== keyVersion || signed.name !== keyVersion) throw new Error("KMS_KEY_VERSION_MISMATCH");
    if (publicKey.algorithm !== "EC_SIGN_ED25519") throw new Error("KMS_ALGORITHM_DOWNGRADE");
    if (!publicKey.pem || !signed.signature) throw new Error("KMS_RESPONSE_INCOMPLETE");
    const signature = Uint8Array.from(signed.signature as Uint8Array);
    const verifier = createPublicKey(publicKey.pem);
    if (verifier.asymmetricKeyType !== "ed25519" || !verify(null, digest, verifier, signature)) throw new Error("KMS_SIGNATURE_LOCAL_VERIFICATION_FAILED");
    return Object.freeze({ signature, publicKey: verifier.export({ type: "spki", format: "der" }).toString("base64") });
  }
}

function abortableTimeout(signal: AbortSignal): number {
  const remaining = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? 0 : 30_000;
  if (remaining === 0) signal.throwIfAborted();
  return remaining;
}
