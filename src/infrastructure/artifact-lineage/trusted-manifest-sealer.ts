import { createPublicKey, randomUUID, verify } from "node:crypto";
import type { ArtifactAccessAuthority, ContentAddressedStoragePort } from "../../contexts/artifact-lineage/application/cas-port.js";
import { canonicalManifestBytes, type ArtifactManifest } from "../../contexts/artifact-lineage/domain/artifact-manifest.js";
import { signingKey } from "../../contexts/artifact-lineage/domain/key-manifest.js";
import type { PostgresPersistence } from "../../persistence/postgres.js";
import { digestBytes } from "../../shared-kernel/digest.js";
import type { RvfWitnessBundle, RvfWitnessPort } from "../../contexts/artifact-lineage/application/rvf-witness-port.js";
import type { TrustedKeyManifestSource } from "./key-manifest-store.js";

/** Fail-closed trusted transition; verification, state CAS, audit, and outbox are one operation. */
export class TrustedManifestSealer {
  constructor(private readonly database: PostgresPersistence, private readonly cas: ContentAddressedStoragePort,
    private readonly keyManifests: TrustedKeyManifestSource,
    private readonly rvfVerifier: Pick<RvfWitnessPort, "verify"> & { readonly verifierKind: "native-ruvector-rvf" },
    private readonly artifactAccess: ArtifactAccessAuthority) {}

  async seal(manifest: ArtifactManifest, environment: string, rvfBundle?: RvfWitnessBundle): Promise<void> {
    if (manifest.status !== "SEALED" || !manifest.keyId || !manifest.signature || manifest.algorithm !== "ed25519") throw new TypeError("SEALED_MANIFEST_REQUIRED");
    const payload = manifest.payload;
    const calculated = digestBytes(canonicalManifestBytes(payload));
    if (calculated !== manifest.manifestDigest.sha256) throw new TypeError("MANIFEST_DIGEST_MISMATCH");
    const { manifest: keyManifest } = await this.keyManifests.loadVerifiedHead({ tenantId: payload.tenantId, repositoryId: payload.repositoryId, environment });
    const key = signingKey(keyManifest, "ARTIFACT_MANIFEST");
    if (key.keyId !== manifest.keyId || key.state !== "ACTIVE" || key.algorithm !== manifest.algorithm) throw new TypeError("MANIFEST_SIGNING_KEY_NOT_TRUSTED");
    const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), type: "spki", format: "der" });
    if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(calculated, "hex"), publicKey, Buffer.from(manifest.signature, "base64"))) throw new TypeError("MANIFEST_SIGNATURE_INVALID");
    const grant = this.artifactAccess.issueRead({ tenantId: payload.tenantId, repositoryId: payload.repositoryId,
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
    if (!await this.cas.exists(payload.artifact)) throw new TypeError("PRIMARY_ARTIFACT_MISSING");
    const artifactBytes = await this.cas.read(payload.artifact, grant);
    if (artifactBytes.byteLength !== payload.size) throw new TypeError("ARTIFACT_SIZE_MISMATCH");
    if (payload.rvfWitness) {
      if (!rvfBundle || rvfBundle.witness.rvfDigest.sha256 !== payload.rvfWitness.rvfDigest.sha256 ||
          rvfBundle.witness.contentSetDigest.sha256 !== payload.rvfWitness.contentSetDigest.sha256) throw new TypeError("RVF_SEAL_MATERIAL_MISMATCH");
      await this.rvfVerifier.verify(rvfBundle, payload.dependencies.map(({ digest }) => digest));
    } else if (rvfBundle) throw new TypeError("UNBOUND_RVF_SEAL_MATERIAL");
    await this.database.tenantTransaction(payload.tenantId, "SERIALIZABLE", async (client) => {
      for (const dependency of payload.dependencies) {
        const row = await client.query("SELECT status,repository_id FROM artifact_manifests WHERE tenant_id=$1 AND artifact_digest=$2", [payload.tenantId, dependency.digest.sha256]);
        if (row.rows[0]?.status !== "SEALED" || row.rows[0].repository_id !== payload.repositoryId) throw new TypeError("DEPENDENCY_NOT_SEALED_OR_SCOPED");
        if (!await this.cas.exists(dependency.digest)) throw new TypeError("DEPENDENCY_ARTIFACT_MISSING");
        await this.cas.read(dependency.digest, grant);
      }
      const updated = await client.query(`UPDATE artifact_manifests SET status='SEALED',version=1,key_id=$3,signature=$4,algorithm='ed25519',finalized_at=transaction_timestamp(),updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND manifest_digest=$2 AND status='STAGED' AND version=0`, [payload.tenantId, manifest.manifestDigest.sha256, manifest.keyId, manifest.signature]);
      if (updated.rowCount !== 1) throw new TypeError("MANIFEST_SEAL_CONFLICT");
      await client.query("INSERT INTO artifact_status_events(tenant_id,manifest_digest,event_version,status,reason,actor) VALUES($1,$2,1,'SEALED',$3,$4)",
        [payload.tenantId, manifest.manifestDigest.sha256, "trusted signature and dependencies verified", payload.producer]);
      const eventId = randomUUID();
      const envelope = { type: "ArtifactManifestSealed", tenantId: payload.tenantId, repositoryId: payload.repositoryId,
        manifestDigest: manifest.manifestDigest, keyId: manifest.keyId, keyManifestSequence: keyManifest.sequence };
      await client.query(`INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope)
        VALUES($1,$2,$3,$4,'evolution.events.v1',$5,$6)`, [payload.tenantId, eventId, payload.repositoryId, manifest.manifestDigest.sha256,
        `${payload.tenantId}/${payload.repositoryId}/${manifest.manifestDigest.sha256}`, envelope]);
    });
  }
}
