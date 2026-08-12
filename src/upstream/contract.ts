export type UpstreamErrorCode = "CANCELLED" | "TIMEOUT" | "INCOMPATIBLE" | "UNAVAILABLE" | "FAILED";

export interface UpstreamFailure {
  readonly code: UpstreamErrorCode;
  readonly authority: string;
  readonly retryable: boolean;
  readonly message: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function negotiateVersion(supported: readonly string[], offered: readonly string[]): string {
  for (const version of supported)
    if (offered.includes(version)) return version;
  throw new Error(`INCOMPATIBLE: no common schema version (${offered.join(",")})`);
}

export function mapUpstreamError(authority: string, error: unknown): UpstreamFailure {
  const value = error as { name?: string; code?: string; message?: string };
  const message = value?.message ?? String(error);
  if (value?.name === "AbortError" || value?.code === "ABORT_ERR")
    return { code: "CANCELLED", authority, retryable: false, message };
  if (value?.code === "ETIMEDOUT" || /timed? ?out/i.test(message))
    return { code: "TIMEOUT", authority, retryable: true, message };
  if (value?.code === "ECONNREFUSED" || value?.code === "MODULE_NOT_FOUND")
    return { code: "UNAVAILABLE", authority, retryable: true, message };
  if (/incompatible|unsupported version/i.test(message))
    return { code: "INCOMPATIBLE", authority, retryable: false, message };
  return { code: "FAILED", authority, retryable: false, message };
}

export async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive integer");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("upstream deadline exceeded", "TimeoutError")), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function hasCurrentReceiptShape(value: unknown): value is {
  readonly payload: Record<string, unknown>;
  readonly signature: string;
  readonly publicKey: string;
  readonly alg: "ed25519";
} {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return receipt.alg === "ed25519"
    && typeof receipt.signature === "string" && receipt.signature.length > 0
    && typeof receipt.publicKey === "string" && receipt.publicKey.length > 0
    && typeof receipt.payload === "object" && receipt.payload !== null && !Array.isArray(receipt.payload);
}
