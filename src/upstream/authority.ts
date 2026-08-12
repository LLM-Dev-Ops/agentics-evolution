export type AuthorityName =
  | "ruflo"
  | "metaharness"
  | "darwin"
  | "flywheel"
  | "redblue"
  | "turn-credit"
  | "router"
  | "harness"
  | "ruvector";

export interface ApprovedDeviation {
  readonly owner: string;
  readonly expiresAt: string;
  readonly threatAnalysis: string;
  readonly adr: string;
}

export interface AuthorityCatalogEntry {
  readonly name: AuthorityName;
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly adapter: `infrastructure/upstream-${string}`;
  readonly owner: string;
  readonly probe: "cli" | "module";
  readonly requiredExports: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly upstreamAdrs: readonly string[];
  readonly contractTests: readonly string[];
  readonly deviations: readonly ApprovedDeviation[];
}

export interface CapabilityProbe {
  readonly authority: AuthorityName;
  readonly requestedVersion: string;
  readonly resolvedVersion: string;
  readonly requestedIntegrity: string;
  readonly resolvedIntegrity: string;
  readonly requiredExports: readonly string[];
  readonly availableExports: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly availableCapabilities: readonly string[];
}

export interface ProbeVerdict {
  readonly ready: boolean;
  readonly failures: readonly string[];
}

export function evaluateProbe(probe: CapabilityProbe): ProbeVerdict {
  const failures: string[] = [];
  if (probe.resolvedVersion !== probe.requestedVersion)
    failures.push(`version mismatch: expected ${probe.requestedVersion}, resolved ${probe.resolvedVersion}`);
  if (probe.resolvedIntegrity !== probe.requestedIntegrity)
    failures.push("integrity mismatch");
  const exports = new Set(probe.availableExports);
  for (const name of probe.requiredExports)
    if (!exports.has(name)) failures.push(`required export missing: ${name}`);
  const capabilities = new Set(probe.availableCapabilities);
  for (const capability of probe.requiredCapabilities)
    if (!capabilities.has(capability)) failures.push(`required capability missing: ${capability}`);
  return { ready: failures.length === 0, failures };
}

export function missingCapabilities(probe: CapabilityProbe): readonly string[] {
  const available = new Set(probe.availableCapabilities);
  return probe.requiredCapabilities.filter((capability) => !available.has(capability));
}
