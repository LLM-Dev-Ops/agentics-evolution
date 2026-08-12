import { digestBytes } from "../../shared-kernel/digest.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";
import type { PolicyDecisionPort, GovernanceScope, PolicyDecision } from "../../contexts/governance/application/upstream-authority-ports.js";

export class PolicyEngineHttpAdapter implements PolicyDecisionPort {
  constructor(private readonly endpoint: URL, private readonly fetcher: typeof fetch = fetch) {}
  async evaluate(scope: GovernanceScope, facts: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<PolicyDecision> {
    const response = await this.fetcher(new URL("/internal/evaluate", this.endpoint), { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), context: { metadata: { ...facts, ...scope } }, trace: true }) });
    if (!response.ok) throw new Error("POLICY_ENGINE_UNAVAILABLE");
    const value = await response.json() as { requestId: string; decision: { decision: string; matchedPolicies?: string[]; matchedRules?: string[] } };
    const outcome = value.decision.decision.toUpperCase();
    if (!["ALLOW", "DENY", "MODIFY", "WARN"].includes(outcome)) throw new Error("POLICY_ENGINE_RESPONSE_INVALID");
    const normalized = { outcome, decisionId: value.requestId, matchedPolicies: value.decision.matchedPolicies ?? [], matchedRules: value.decision.matchedRules ?? [] };
    return Object.freeze({ ...normalized, decisionDigest: digestBytes(new TextEncoder().encode(canonicalJson(normalized))) }) as PolicyDecision;
  }
}
