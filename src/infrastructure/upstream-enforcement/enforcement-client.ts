import type { EnforcementDecision, EnforcementPort } from "../../contexts/governance/application/upstream-authority-ports.js";
export class EnforcementHttpAdapter implements EnforcementPort {
  constructor(private readonly endpoint: URL, private readonly fetcher: typeof fetch = fetch) {}
  async enforce(intent: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<EnforcementDecision> {
    const response = await this.fetcher(new URL("/v1/enforce", this.endpoint), { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(intent) });
    if (!response.ok) throw new Error("ENFORCEMENT_UNAVAILABLE"); const value = await response.json() as Record<string, unknown>;
    if (typeof value.allowed !== "boolean" || typeof value.decisionId !== "string") throw new Error("ENFORCEMENT_RESPONSE_INVALID");
    return Object.freeze({ allowed: value.allowed, decisionId: value.decisionId, reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : null });
  }
}
