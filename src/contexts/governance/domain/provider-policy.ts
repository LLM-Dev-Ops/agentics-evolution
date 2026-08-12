import type { DataClassification } from "./capability.js";
import type { TenantSecurityProfile } from "./privacy.js";
const rank: Record<DataClassification, number> = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3, SECRET_PROHIBITED: 4 };
export function effectiveClassification(values: readonly DataClassification[]): DataClassification { if (!values.length) throw new TypeError("DATA_CLASSIFICATION_REQUIRED"); return values.reduce((current, value) => rank[value] > rank[current] ? value : current); }
export function assertNoClassificationDowngrade(source: DataClassification, target: DataClassification): void { if (rank[target] < rank[source]) throw new TypeError("CLASSIFICATION_DOWNGRADE_FORBIDDEN"); }
export interface ProviderExecutionClaim { readonly providerId: string; readonly region: string; readonly trainingOptOut: boolean; readonly privateOrLocal: boolean; }
export function authorizeProvider(profile: TenantSecurityProfile, dataClass: DataClassification, claim: ProviderExecutionClaim): void {
  if (dataClass === "SECRET_PROHIBITED") throw new TypeError("SECRET_PROHIBITED_QUARANTINE_REQUIRED");
  if (!profile.providers.includes(claim.providerId) || profile.region !== claim.region || profile.trainingOptOut && !claim.trainingOptOut) throw new TypeError("PROVIDER_RESIDENCY_DENIED");
  if (dataClass === "RESTRICTED" && !claim.privateOrLocal) throw new TypeError("RESTRICTED_PROVIDER_DENIED");
}
