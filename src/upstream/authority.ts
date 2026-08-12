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

export interface CapabilityProbe {
  readonly authority: AuthorityName;
  readonly requestedVersion: string;
  readonly resolvedVersion: string;
  readonly requiredCapabilities: readonly string[];
  readonly availableCapabilities: readonly string[];
}

export function missingCapabilities(probe: CapabilityProbe): readonly string[] {
  const available = new Set(probe.availableCapabilities);
  return probe.requiredCapabilities.filter((capability) => !available.has(capability));
}
