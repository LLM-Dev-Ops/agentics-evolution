import { randomUUID } from "node:crypto";
import type { PostgresPersistence } from "../../persistence/postgres.js";
import { digestBytes, digestReference, type DigestReference } from "../../shared-kernel/digest.js";
import type { RepositoryId, TenantId } from "../../shared-kernel/identity.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";
import type { KeyManifest } from "../../contexts/artifact-lineage/domain/key-manifest.js";

export interface SignedKeyManifestCheckpoint {
  readonly manifest: KeyManifest;
  readonly manifestDigest: DigestReference;
  readonly signerKeyId: string;
  readonly signature: string;
}
export interface KeyManifestCheckpointVerifier {
  verify(value: { readonly manifestDigest: DigestReference; readonly signerKeyId: string; readonly signature: string }): Promise<boolean>;
}
export interface TrustedKeyManifestSource {
  loadVerifiedHead(scope: { tenantId: TenantId; repositoryId: RepositoryId; environment: string }): Promise<SignedKeyManifestCheckpoint>;
}

/** Append-only checkpoints with a compare-and-swap head and atomic outbox notification. */
export class PostgresKeyManifestStore {
  constructor(private readonly database: PostgresPersistence, private readonly verifier: KeyManifestCheckpointVerifier) {}
  async rotate(scope: { tenantId: TenantId; repositoryId: RepositoryId; environment: string }, checkpoint: SignedKeyManifestCheckpoint, expectedSequence: number): Promise<void> {
    const bytes = new TextEncoder().encode(canonicalJson(checkpoint.manifest));
    if (digestBytes(bytes) !== checkpoint.manifestDigest.sha256 || !checkpoint.signature || !checkpoint.signerKeyId) throw new TypeError("INVALID_KEY_MANIFEST_CHECKPOINT");
    if (!await this.verifier.verify(checkpoint)) throw new TypeError("KEY_MANIFEST_CHECKPOINT_SIGNATURE_INVALID");
    if (checkpoint.manifest.sequence !== expectedSequence + 1) throw new TypeError("KEY_MANIFEST_SEQUENCE_GAP");
    await this.database.tenantTransaction(scope.tenantId, "SERIALIZABLE", async (client) => {
      const head = await client.query("SELECT sequence FROM key_manifest_heads WHERE tenant_id=$1 AND repository_id=$2 AND environment=$3 FOR UPDATE", [scope.tenantId, scope.repositoryId, scope.environment]);
      const actual = Number(head.rows[0]?.sequence ?? 0);
      if (actual !== expectedSequence) throw Object.assign(new Error("KEY_MANIFEST_CAS_CONFLICT"), { code: "40001" });
      await client.query(`INSERT INTO key_manifest_checkpoints(tenant_id,repository_id,environment,sequence,manifest,manifest_digest,signer_key_id,signature)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [scope.tenantId, scope.repositoryId, scope.environment, checkpoint.manifest.sequence, checkpoint.manifest, checkpoint.manifestDigest.sha256, checkpoint.signerKeyId, checkpoint.signature]);
      if (expectedSequence === 0) await client.query("INSERT INTO key_manifest_heads(tenant_id,repository_id,environment,sequence,manifest_digest) VALUES($1,$2,$3,$4,$5)", [scope.tenantId, scope.repositoryId, scope.environment, checkpoint.manifest.sequence, checkpoint.manifestDigest.sha256]);
      else {
        const updated = await client.query("UPDATE key_manifest_heads SET sequence=$4,manifest_digest=$5 WHERE tenant_id=$1 AND repository_id=$2 AND environment=$3 AND sequence=$6", [scope.tenantId, scope.repositoryId, scope.environment, checkpoint.manifest.sequence, checkpoint.manifestDigest.sha256, expectedSequence]);
        if (updated.rowCount !== 1) throw Object.assign(new Error("KEY_MANIFEST_CAS_CONFLICT"), { code: "40001" });
      }
      const eventId = randomUUID();
      const envelope = { type: "KeyManifestRotated", tenantId: scope.tenantId, repositoryId: scope.repositoryId, environment: scope.environment,
        sequence: checkpoint.manifest.sequence, manifestDigest: checkpoint.manifestDigest };
      await client.query(`INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope)
        VALUES($1,$2,$3,$4,'evolution.events.v1',$5,$6)`, [scope.tenantId, eventId, scope.repositoryId, `key-manifest:${scope.environment}`, `${scope.tenantId}/${scope.repositoryId}/key-manifest:${scope.environment}`, envelope]);
    });
  }
  async loadVerifiedHead(scope: { tenantId: TenantId; repositoryId: RepositoryId; environment: string }): Promise<SignedKeyManifestCheckpoint> {
    const checkpoint = await this.database.tenantTransaction(scope.tenantId, "REPEATABLE READ", async (client) => {
      const result = await client.query(`SELECT c.manifest,c.manifest_digest,c.signer_key_id,c.signature,c.sequence
        FROM key_manifest_heads h JOIN key_manifest_checkpoints c USING(tenant_id,repository_id,environment,sequence)
        WHERE h.tenant_id=$1 AND h.repository_id=$2 AND h.environment=$3`, [scope.tenantId, scope.repositoryId, scope.environment]);
      const row = result.rows[0];
      if (!row) throw new TypeError("KEY_MANIFEST_HEAD_NOT_FOUND");
      if (Number(row.sequence) !== Number(row.manifest.sequence)) throw new TypeError("KEY_MANIFEST_HEAD_SEQUENCE_MISMATCH");
      return Object.freeze({ manifest: row.manifest as KeyManifest,
        manifestDigest: digestReference({ uri: `cas://sha256/${row.manifest_digest}`, sha256: row.manifest_digest }),
        signerKeyId: String(row.signer_key_id), signature: String(row.signature) });
    });
    const calculated = digestBytes(new TextEncoder().encode(canonicalJson(checkpoint.manifest)));
    if (calculated !== checkpoint.manifestDigest.sha256 || !await this.verifier.verify(checkpoint)) throw new TypeError("KEY_MANIFEST_HEAD_NOT_TRUSTED");
    return checkpoint;
  }
  static checkpoint(manifest: KeyManifest, signerKeyId: string, signature: string): SignedKeyManifestCheckpoint {
    const sha256 = digestBytes(new TextEncoder().encode(canonicalJson(manifest)));
    return Object.freeze({ manifest, manifestDigest: digestReference({ uri: `cas://sha256/${sha256}`, sha256 }), signerKeyId, signature });
  }
}
