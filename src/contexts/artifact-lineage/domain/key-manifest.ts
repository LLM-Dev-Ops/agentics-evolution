import { deepFreeze } from "../../../shared-kernel/immutable.js";
import type { SigningPurpose } from "./signing-purpose.js";

export type KeyState = "PENDING" | "ACTIVE" | "RETIRED" | "REVOKED";
export interface PublicSigningKey {
  readonly keyId: string;
  readonly version: string;
  readonly purpose: SigningPurpose;
  readonly algorithm: "ed25519";
  readonly publicKey: string;
  readonly validFrom: string;
  readonly state: KeyState;
  readonly predecessor: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}
export interface KeyManifest {
  readonly schema: "agentics.key-manifest/v1";
  readonly sequence: number;
  readonly active: Readonly<Partial<Record<SigningPurpose, string>>>;
  readonly keys: readonly PublicSigningKey[];
}

export function createKeyManifest(key: PublicSigningKey): KeyManifest {
  validateKey(key);
  if (key.state !== "PENDING") throw new TypeError("INITIAL_KEY_MUST_BE_PENDING");
  return deepFreeze({ schema: "agentics.key-manifest/v1", sequence: 1, active: {}, keys: [key] });
}
export function addPendingKey(manifest: KeyManifest, key: PublicSigningKey): KeyManifest {
  validateKey(key);
  if (key.state !== "PENDING" || manifest.keys.some((item) => item.keyId === key.keyId)) throw new TypeError("INVALID_PENDING_KEY");
  return next(manifest, manifest.active, [...manifest.keys, key]);
}
export function activateKey(manifest: KeyManifest, keyId: string): KeyManifest {
  const key = requireKey(manifest, keyId);
  if (key.state !== "PENDING") throw new TypeError("KEY_NOT_PENDING");
  const previous = manifest.active[key.purpose];
  const keys = manifest.keys.map((item) => {
    if (item.keyId === keyId) return { ...item, state: "ACTIVE" as const };
    if (item.keyId === previous) return { ...item, state: "RETIRED" as const };
    return item;
  });
  return next(manifest, { ...manifest.active, [key.purpose]: keyId }, keys);
}
export function revokeKey(manifest: KeyManifest, keyId: string, revokedAt: string, reason: string): KeyManifest {
  const key = requireKey(manifest, keyId);
  if (key.state === "REVOKED" || !reason.trim() || Number.isNaN(Date.parse(revokedAt))) throw new TypeError("INVALID_KEY_REVOCATION");
  const keys = manifest.keys.map((item) => item.keyId === keyId
    ? { ...item, state: "REVOKED" as const, revokedAt, revocationReason: reason } : item);
  const active = { ...manifest.active };
  if (active[key.purpose] === keyId) delete active[key.purpose];
  return next(manifest, active, keys);
}
export function signingKey(manifest: KeyManifest, purpose: SigningPurpose): PublicSigningKey {
  const keyId = manifest.active[purpose];
  if (!keyId) throw new TypeError("NO_ACTIVE_SIGNING_KEY");
  const key = requireKey(manifest, keyId);
  if (key.state !== "ACTIVE" || key.purpose !== purpose) throw new TypeError("ACTIVE_KEY_INVARIANT_VIOLATION");
  return key;
}
function next(manifest: KeyManifest, active: KeyManifest["active"], keys: readonly PublicSigningKey[]): KeyManifest {
  return deepFreeze({ ...manifest, sequence: manifest.sequence + 1, active, keys });
}
function requireKey(manifest: KeyManifest, keyId: string): PublicSigningKey {
  const key = manifest.keys.find((item) => item.keyId === keyId);
  if (!key) throw new TypeError("UNKNOWN_KEY");
  return key;
}
function validateKey(key: PublicSigningKey): void {
  if (!/^[A-Za-z0-9._:/-]{1,256}$/.test(key.keyId) || !key.version || !key.publicKey || key.algorithm !== "ed25519" ||
      Number.isNaN(Date.parse(key.validFrom)) || key.revokedAt !== null || key.revocationReason !== null) throw new TypeError("INVALID_PUBLIC_SIGNING_KEY");
}
