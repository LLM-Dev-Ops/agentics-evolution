import type { AuthorityName, CapabilityProbe } from "../../upstream/authority.js";

/** DDD-008 anti-corruption boundary. Domain code consumes narrower context ports. */
export interface UpstreamAuthorityPort {
  probe(authority: AuthorityName): Promise<CapabilityProbe>;
}

export interface AuthorityContract {
  readonly authority: AuthorityName;
  readonly packageName: string;
  readonly exactVersion: string;
  readonly adapterPath: `infrastructure/upstream-${string}`;
  readonly requiredCapabilities: readonly string[];
}
