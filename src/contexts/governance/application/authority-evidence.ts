import { KeyObject, createPublicKey, verify } from "node:crypto";
import { DigestReference } from "../../../shared-kernel/digest.js";
import { EvolutionEnvelope } from "../../../shared-kernel/evolution-envelope.js";
import { canonicalJson } from "../../../shared-kernel/immutable.js";
import { digestBytes, sha256Digest } from "../../../shared-kernel/digest.js";
import type { TransitionEvidenceVerifier } from "../domain/trust-aggregate.js";

export type TransitionAuthority = "Dream" | "Darwin" | "Flywheel" | "Governance";
export interface AuthorityEvidenceStatement {
  readonly schema: "agentics.authority-evidence/v1";
  readonly keyId: string;
  readonly authority: TransitionAuthority;
  readonly eventBinding: string;
  readonly verdict: "VALIDATED" | "ADMITTED" | "PROVED" | "AUTHORIZED";
  readonly signature: string;
}
export interface AuthorityTrustRoot { readonly authority: TransitionAuthority; readonly keyId: string; readonly publicKeyPem: string; }

export function transitionEventBinding(event: EvolutionEnvelope): string {
  return digestBytes(new TextEncoder().encode(canonicalJson({
    envelopeSchema: event.envelopeSchema, schemaVersion: event.schemaVersion, id: event.id, type: event.type,
    tenantId: event.tenantId, repositoryId: event.repositoryId, aggregateId: event.aggregateId, cycleId: event.cycleId,
    actorId: event.actorId, occurredAt: event.occurredAt, causationId: event.causationId, correlationId: event.correlationId,
    idempotencyKey: event.idempotencyKey, policyEpoch: event.policyEpoch, sourceRef: event.sourceRef, payload: event.payload
  })));
}

export class Ed25519AuthorityEvidenceVerifier {
  readonly #keys: ReadonlyMap<string, { authority: TransitionAuthority; key: KeyObject }>;
  constructor(roots: readonly AuthorityTrustRoot[]) {
    if (roots.length === 0) throw new TypeError("at least one authority trust root is required");
    this.#keys = new Map(roots.map((root) => {
      if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(root.keyId)) throw new TypeError("invalid authority key ID");
      return [root.keyId, { authority: root.authority, key: createPublicKey(root.publicKeyPem) }];
    }));
    if (this.#keys.size !== roots.length) throw new TypeError("duplicate authority key ID");
  }
  readonly verify: TransitionEvidenceVerifier = ({ authority, event, bytes }: { authority: TransitionAuthority; event: EvolutionEnvelope; reference: DigestReference; bytes: Uint8Array }) => {
    let statement: AuthorityEvidenceStatement;
    try { statement = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return false; }
    const root = this.#keys.get(statement.keyId);
    const verdict = authority === "Dream" ? "VALIDATED" : authority === "Darwin" ? "ADMITTED" : authority === "Flywheel" ? "PROVED" : "AUTHORIZED";
    if (statement.schema !== "agentics.authority-evidence/v1" || !root || root.authority !== authority || statement.authority !== authority ||
      statement.verdict !== verdict || statement.eventBinding !== transitionEventBinding(event) || !/^[A-Za-z0-9+/]+={0,2}$/.test(statement.signature)) return false;
    const unsigned = canonicalJson({ schema: statement.schema, keyId: statement.keyId, authority: statement.authority,
      eventBinding: sha256Digest(statement.eventBinding), verdict: statement.verdict });
    return verify(null, Buffer.from(unsigned), root.key, Buffer.from(statement.signature, "base64"));
  };
}
