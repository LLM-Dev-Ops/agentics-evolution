import type { DataClassification } from "./capability.js";
export const retentionDays = { SCRATCH: 7, RAW_OBSERVATION: 30, CANDIDATE_FAILURE: 90, SUCCESSFUL_LINEAGE: 400, SECURITY_AUDIT: 400 } as const;
export type RetentionCategory = keyof typeof retentionDays;
export interface TenantSecurityProfile { readonly tenantId: string; readonly region: string; readonly maximumClassification: DataClassification;
  readonly providers: readonly string[]; readonly trainingOptOut: boolean; readonly retention: Readonly<Record<RetentionCategory, number>>; }
export function tenantSecurityProfile(value: TenantSecurityProfile): TenantSecurityProfile {
  if (!value.tenantId || !/^[a-z]{2}(?:-[a-z0-9]+)+$/i.test(value.region) || value.providers.length === 0 || !value.trainingOptOut) throw new TypeError("INVALID_TENANT_SECURITY_PROFILE");
  for (const [category, baseline] of Object.entries(retentionDays)) if (!Number.isSafeInteger(value.retention[category as RetentionCategory]) || value.retention[category as RetentionCategory] < baseline) throw new TypeError("RETENTION_BELOW_POLICY_MINIMUM");
  return Object.freeze({ ...value, providers: Object.freeze([...new Set(value.providers)].sort()), retention: Object.freeze({ ...value.retention }) });
}
export function retentionExpiresAt(category: RetentionCategory, createdAt: string, profile: TenantSecurityProfile): string {
  const created = Date.parse(createdAt); if (!Number.isFinite(created)) throw new TypeError("INVALID_RETENTION_CLOCK");
  return new Date(created + profile.retention[category] * 86_400_000).toISOString();
}
