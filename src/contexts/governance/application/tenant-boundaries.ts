import { createHmac } from "node:crypto";
import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
function segment(value: string): string { if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value.includes("..")) throw new TypeError("INVALID_NAMESPACE_SEGMENT"); return value; }
export const tenantCacheKey = (tenant: TenantId, repo: RepositoryId, kind: string, id: string): string => `t:${segment(tenant)}:r:${segment(repo)}:${segment(kind)}:${segment(id)}`;
export const tenantVectorNamespace = (tenant: TenantId, repo: RepositoryId, domain: string): string => `tenant/${segment(tenant)}/repository/${segment(repo)}/domain/${segment(domain)}`;
export const tenantKeyAlias = (tenant: TenantId, repo: RepositoryId, purpose: string): string => `tenants/${segment(tenant)}/repositories/${segment(repo)}/keys/${segment(purpose)}`;
export function tenantMetricLabel(tenant: TenantId, secret: Uint8Array): string { if (secret.byteLength < 32) throw new TypeError("TELEMETRY_SECRET_TOO_SHORT"); return createHmac("sha256", secret).update(tenant).digest("hex").slice(0, 24); }
export function privacySafeLog(fields: Record<string, unknown>): Readonly<Record<string, string | number | boolean>> {
  const prohibited = /prompt|secret|token|authorization|cookie|content|source|email/i; const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) if (!prohibited.test(key) && ["string", "number", "boolean"].includes(typeof value)) output[key] = typeof value === "string" ? value.slice(0, 256) : value as number | boolean;
  return Object.freeze(output);
}
