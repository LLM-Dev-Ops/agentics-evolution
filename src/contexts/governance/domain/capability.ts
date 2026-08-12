import type { Money } from "../../../shared-kernel/money.js";

export const capabilityActions = ["cycle.read", "cycle.run", "candidate.generate", "candidate.evaluate", "evidence.reset",
  "promotion.qualify", "promotion.authorize", "rollout.start", "rollout.rollback", "repository.write", "release.publish"] as const;
export type CapabilityAction = typeof capabilityActions[number];
export interface CapabilityEnvelope {
  readonly action: CapabilityAction; readonly tenantId: string; readonly repositories: readonly string[]; readonly paths: readonly string[];
  readonly tools: readonly string[]; readonly network: readonly string[]; readonly providers: readonly string[]; readonly models: readonly string[];
  readonly regions: readonly string[]; readonly classification: DataClassification; readonly spend: Money; readonly concurrency: number;
  readonly expiresAt: string; readonly depth: number; readonly uses: number;
}
export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "SECRET_PROHIBITED";
const rank: Record<DataClassification, number> = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3, SECRET_PROHIBITED: 4 };
const safeToken = /^[a-z0-9][a-z0-9._:/@*-]{0,255}$/i;

export function normalizeEnvelope(value: CapabilityEnvelope): CapabilityEnvelope {
  if (!capabilityActions.includes(value.action) || !safeToken.test(value.tenantId) || !Number.isSafeInteger(value.concurrency) || value.concurrency < 1 ||
      !Number.isSafeInteger(value.depth) || value.depth < 0 || !Number.isSafeInteger(value.uses) || value.uses < 1 || !Number.isFinite(Date.parse(value.expiresAt)))
    throw new TypeError("INVALID_CAPABILITY_ENVELOPE");
  const normalize = (items: readonly string[], kind: string) => Object.freeze([...new Set(items.map((item) => {
    const normalized = item.normalize("NFC");
    if (!safeToken.test(normalized) || normalized.includes("..") || normalized.startsWith("/") || normalized.includes("\\")) throw new TypeError(`INVALID_${kind}`);
    return normalized;
  }))].sort());
  return Object.freeze({ ...value, repositories: normalize(value.repositories, "REPOSITORY"), paths: normalize(value.paths, "PATH"),
    tools: normalize(value.tools, "TOOL"), network: normalize(value.network, "NETWORK"), providers: normalize(value.providers, "PROVIDER"),
    models: normalize(value.models, "MODEL"), regions: normalize(value.regions, "REGION") });
}
export function isEnvelopeSubset(childValue: CapabilityEnvelope, parentValue: CapabilityEnvelope): boolean {
  const child = normalizeEnvelope(childValue); const parent = normalizeEnvelope(parentValue); const subset = (a: readonly string[], b: readonly string[]) => a.every((item) => b.includes(item));
  return child.action === parent.action && child.tenantId === parent.tenantId && subset(child.repositories, parent.repositories) && subset(child.paths, parent.paths) &&
    subset(child.tools, parent.tools) && subset(child.network, parent.network) && subset(child.providers, parent.providers) && subset(child.models, parent.models) &&
    subset(child.regions, parent.regions) && rank[child.classification] <= rank[parent.classification] && child.spend.currency === parent.spend.currency &&
    child.spend.minorUnits <= parent.spend.minorUnits && child.concurrency <= parent.concurrency && Date.parse(child.expiresAt) <= Date.parse(parent.expiresAt) &&
    child.depth <= parent.depth && child.uses <= parent.uses;
}
export function intersectEnvelopes(left: CapabilityEnvelope, right: CapabilityEnvelope): CapabilityEnvelope {
  if (left.action !== right.action || left.tenantId !== right.tenantId || left.spend.currency !== right.spend.currency) throw new TypeError("INCOMPATIBLE_CAPABILITY_ENVELOPES");
  const common = (a: readonly string[], b: readonly string[]) => a.filter((item) => b.includes(item)); const className = rank[left.classification] <= rank[right.classification] ? left.classification : right.classification;
  return normalizeEnvelope({ ...left, repositories: common(left.repositories, right.repositories), paths: common(left.paths, right.paths), tools: common(left.tools, right.tools),
    network: common(left.network, right.network), providers: common(left.providers, right.providers), models: common(left.models, right.models), regions: common(left.regions, right.regions),
    classification: className, spend: left.spend.minorUnits <= right.spend.minorUnits ? left.spend : right.spend, concurrency: Math.min(left.concurrency, right.concurrency),
    expiresAt: Date.parse(left.expiresAt) <= Date.parse(right.expiresAt) ? left.expiresAt : right.expiresAt, depth: Math.min(left.depth, right.depth), uses: Math.min(left.uses, right.uses) });
}
