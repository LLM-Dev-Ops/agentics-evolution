import { KeyObject, createPublicKey, verify } from "node:crypto";
import { DigestReference, digestReference } from "../../../shared-kernel/digest.js";
import { EvolutionEnvelope } from "../../../shared-kernel/evolution-envelope.js";
import { canonicalJson } from "../../../shared-kernel/immutable.js";
import { digestBytes, sha256Digest } from "../../../shared-kernel/digest.js";

export type TransitionAuthority = "Dream" | "Darwin" | "Flywheel" | "Governance";
export interface AuthorityEvidenceStatement {
  readonly schema: "agentics.authority-evidence/v1";
  readonly keyId: string;
  readonly authority: TransitionAuthority;
  readonly eventBinding: string;
  readonly verdict: "VALIDATED" | "ADMITTED" | "PROVED" | "AUTHORIZED";
  readonly proof: Readonly<Record<string, unknown>>;
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
    const authorities = new Set(roots.map(({ authority }) => authority));
    for (const required of ["Dream", "Darwin", "Flywheel", "Governance"]) if (!authorities.has(required as TransitionAuthority))
      throw new TypeError(`missing ${required} authority trust root`);
    this.#keys = new Map(roots.map((root) => {
      if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(root.keyId)) throw new TypeError("invalid authority key ID");
      return [root.keyId, { authority: root.authority, key: createPublicKey(root.publicKeyPem) }];
    }));
    if (this.#keys.size !== roots.length) throw new TypeError("duplicate authority key ID");
    Object.defineProperty(this, "verify", { value: this.verify.bind(this), writable: false, configurable: false });
    Object.freeze(this);
  }
  verify({ authority, event, bytes }: { authority: TransitionAuthority; event: EvolutionEnvelope; reference: DigestReference; bytes: Uint8Array }): boolean {
    if (bytes.byteLength > 65_536) return false;
    let statement: AuthorityEvidenceStatement;
    try { statement = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return false; }
    if (!statement || typeof statement !== "object" || Array.isArray(statement) ||
      Object.keys(statement).sort().join(",") !== ["authority", "eventBinding", "keyId", "proof", "schema", "signature", "verdict"].sort().join(",") ||
      !statement.proof || typeof statement.proof !== "object" || Array.isArray(statement.proof)) return false;
    const root = this.#keys.get(statement.keyId);
    const verdict = authority === "Dream" ? "VALIDATED" : authority === "Darwin" ? "ADMITTED" : authority === "Flywheel" ? "PROVED" : "AUTHORIZED";
    if (statement.schema !== "agentics.authority-evidence/v1" || !root || root.authority !== authority || statement.authority !== authority ||
      statement.verdict !== verdict || statement.eventBinding !== transitionEventBinding(event) || !/^[A-Za-z0-9+/]+={0,2}$/.test(statement.signature)) return false;
    const proofKeys = authority === "Dream" ? ["sourceValidated"] : authority === "Darwin" ? ["mutationAdmitted"]
      : authority === "Flywheel" ? ["gateReceipt", "replayVerdict", "sequentialEvidence"] : ["approvalId", "capability", "constraints"];
    if (Object.keys(statement.proof).sort().join(",") !== [...proofKeys].sort().join(",")) return false;
    const isDigestRef = (value: unknown) => {
      try { digestReference(value as DigestReference); return true; } catch { return false; }
    };
    if ((authority === "Dream" && statement.proof.sourceValidated !== true) ||
      (authority === "Darwin" && statement.proof.mutationAdmitted !== true) ||
      (authority === "Flywheel" && (!isDigestRef(statement.proof.gateReceipt) || statement.proof.replayVerdict !== "PASS" || !isDigestRef(statement.proof.sequentialEvidence))) ||
      (authority === "Governance" && (typeof statement.proof.approvalId !== "string" || statement.proof.approvalId.length < 3 ||
        !["PROMOTE", "REVOKE"].includes(String(statement.proof.capability)) || !statement.proof.constraints || typeof statement.proof.constraints !== "object" || Array.isArray(statement.proof.constraints)))) return false;
    if (authority === "Governance" && statement.proof.capability !== (event.type === "AuthorizationRevoked" ? "REVOKE" : "PROMOTE")) return false;
    const unsigned = canonicalJson({ schema: statement.schema, keyId: statement.keyId, authority: statement.authority,
      eventBinding: sha256Digest(statement.eventBinding), verdict: statement.verdict, proof: statement.proof });
    return verify(null, Buffer.from(unsigned), root.key, Buffer.from(statement.signature, "base64"));
  }

  parseVerifiedProof(bytes: Uint8Array): Readonly<Record<string, unknown>> {
    return Object.freeze({ ...(JSON.parse(new TextDecoder().decode(bytes)) as AuthorityEvidenceStatement).proof });
  }
}
