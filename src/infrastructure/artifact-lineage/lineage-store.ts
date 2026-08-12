import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PostgresPersistence } from "../../persistence/postgres.js";
import type { ContentAddressedStoragePort, StagedArtifact } from "../../contexts/artifact-lineage/application/cas-port.js";
import type { ArtifactAccessAuthority } from "../../contexts/artifact-lineage/application/cas-port.js";
import type { LegalHoldAuthorization, LegalHoldAuthorizationVerifier } from "../../contexts/artifact-lineage/application/legal-hold-authorization.js";
import type { ArtifactManifest } from "../../contexts/artifact-lineage/domain/artifact-manifest.js";
import { repositoryId as parseRepositoryId, tenantId as parseTenantId } from "../../shared-kernel/identity.js";
import { digestReference } from "../../shared-kernel/digest.js";

const MINIMUM_RETENTION_DAYS = { OPERATIONAL_SCRATCH: 7, CANDIDATE_ARCHIVE: 30, EVALUATION_EVIDENCE: 365, AUTHORIZATION_AUDIT: 2555, LEGAL_HOLD: 36500 } as const;
export class ArtifactLineageStore {
  constructor(readonly database: PostgresPersistence, readonly cas: ContentAddressedStoragePort, readonly access: ArtifactAccessAuthority, readonly holdVerifier?: LegalHoldAuthorizationVerifier) {}
  async stage(manifest: ArtifactManifest): Promise<void> {
    void manifest; throw new TypeError("RAW_MANIFEST_STAGE_DISABLED_USE_PUBLISH_STAGED");
  }
  async publishStaged(manifest: ArtifactManifest, staged: StagedArtifact): Promise<void> {
    if (manifest.status !== "STAGED") throw new TypeError("STAGED_MANIFEST_REQUIRED"); const payload = manifest.payload;
    if (staged.expected.sha256 !== payload.artifact.sha256 || staged.metadata.tenantId !== payload.tenantId || staged.metadata.repositoryId !== payload.repositoryId)
      throw new TypeError("STAGED_ARTIFACT_SCOPE_MISMATCH");
    await this.database.tenantTransaction(payload.tenantId, "SERIALIZABLE", async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [payload.artifact.sha256]);
      await this.cas.finalize(staged); const grant = this.access.issueRead({ tenantId: payload.tenantId, repositoryId: payload.repositoryId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
      const bytes = await this.cas.read(payload.artifact, grant); if (bytes.byteLength !== payload.size) throw new TypeError("PUBLISHED_ARTIFACT_SIZE_MISMATCH");
      const existing = await client.query("SELECT payload FROM artifact_manifests WHERE tenant_id=$1 AND manifest_digest=$2", [payload.tenantId, manifest.manifestDigest.sha256]);
      if (existing.rowCount) { if (JSON.stringify(existing.rows[0].payload) !== JSON.stringify(payload)) throw new TypeError("MANIFEST_IDEMPOTENCY_CONFLICT"); return; }
      const retainUntil = new Date(Date.parse(payload.createdAt) + MINIMUM_RETENTION_DAYS[payload.retention] * 86_400_000);
      await client.query(`INSERT INTO artifact_manifests(tenant_id,repository_id,manifest_digest,artifact_digest,payload,status,retain_until,legal_hold)
        VALUES($1,$2,$3,$4,$5,'STAGED',$6,$7)`, [payload.tenantId, payload.repositoryId, manifest.manifestDigest.sha256, payload.artifact.sha256, payload, retainUntil, payload.retention === "LEGAL_HOLD"]);
      for (const [ordinal, dependency] of payload.dependencies.entries()) await client.query(`INSERT INTO artifact_dependencies(tenant_id,manifest_digest,ordinal,dependency_digest,role)
        VALUES($1,$2,$3,$4,$5)`, [payload.tenantId, manifest.manifestDigest.sha256, ordinal, dependency.digest.sha256, dependency.role]);
      await client.query(`INSERT INTO artifact_digest_references(tenant_id,repository_id,artifact_digest,manifest_digest) VALUES($1,$2,$3,$4)`,
        [payload.tenantId, payload.repositoryId, payload.artifact.sha256, manifest.manifestDigest.sha256]);
      await statusEvent(client, payload.tenantId, manifest.manifestDigest.sha256, 0, "STAGED", "manifest staged", payload.producer);
    });
  }
  async setLegalHold(tenantId: string, manifestDigest: string, held: boolean, authorization: LegalHoldAuthorization): Promise<void> {
    if (!this.holdVerifier) throw new TypeError("LEGAL_HOLD_AUTHORIZATION_VERIFIER_REQUIRED");
    const verified = await this.holdVerifier.verify(authorization); const action = held ? "PLACE" : "RELEASE";
    if (verified.tenantId !== tenantId || verified.manifestDigest !== manifestDigest || verified.action !== action || Date.parse(verified.expiresAt) <= Date.now())
      throw new TypeError("LEGAL_HOLD_AUTHORIZATION_SCOPE_MISMATCH");
    await this.database.tenantTransaction(tenantId, "SERIALIZABLE", async (client) => {
      await client.query("INSERT INTO artifact_legal_hold_nonces(tenant_id,nonce,manifest_digest,action) VALUES($1,$2,$3,$4)", [tenantId, verified.nonce, manifestDigest, action]);
      const result = await client.query("UPDATE artifact_manifests SET legal_hold=$3,version=version+1,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND manifest_digest=$2 RETURNING version",
        [tenantId, manifestDigest, held]); if (!result.rows[0]) throw new TypeError("MANIFEST_NOT_FOUND");
      await statusEvent(client, tenantId, manifestDigest, Number(result.rows[0].version), held ? "LEGAL_HOLD_PLACED" : "LEGAL_HOLD_RELEASED", held ? "hold placed" : "hold released", verified.actor);
    });
  }
  async transitionStatus(tenantId: string, manifestDigest: string, status: "REVOKED" | "EXPIRED", actor: string, reason: string): Promise<void> {
    if (!reason) throw new TypeError("STATUS_REASON_REQUIRED");
    await this.database.tenantTransaction(tenantId, "SERIALIZABLE", async (client) => {
      const result = await client.query(`UPDATE artifact_manifests SET status=$3,version=version+1,updated_at=transaction_timestamp()
        WHERE tenant_id=$1 AND manifest_digest=$2 AND status='SEALED' RETURNING version`, [tenantId, manifestDigest, status]);
      if (!result.rows[0]) throw new TypeError("MANIFEST_STATUS_CONFLICT"); await statusEvent(client, tenantId, manifestDigest, Number(result.rows[0].version), status, reason, actor);
    });
  }
  async garbageCollect(tenantId: string, actor: string, now = new Date()): Promise<{ marked: number; swept: number }> {
    const runId = randomUUID(); const candidates = await this.database.tenantTransaction(tenantId, "REPEATABLE READ", async (client) => {
      await client.query("INSERT INTO artifact_gc_runs(tenant_id,run_id,cutoff,status) VALUES($1,$2,$3,'MARKING')", [tenantId, runId, now]);
      const rows = await client.query(`SELECT manifest_digest,artifact_digest,version FROM artifact_manifests WHERE tenant_id=$1 AND status IN ('REVOKED','EXPIRED')
        AND legal_hold=false AND retain_until<$2 AND updated_at<$2 AND NOT EXISTS (SELECT 1 FROM artifact_dependencies d JOIN artifact_manifests parent
          ON parent.tenant_id=d.tenant_id AND parent.manifest_digest=d.manifest_digest WHERE d.tenant_id=$1 AND d.dependency_digest=artifact_manifests.artifact_digest
          AND parent.status='SEALED') FOR UPDATE SKIP LOCKED`, [tenantId, now]);
      for (const row of rows.rows) await client.query("INSERT INTO artifact_gc_candidates(tenant_id,run_id,manifest_digest,expected_version) VALUES($1,$2,$3,$4)", [tenantId, runId, row.manifest_digest, row.version]);
      await client.query("UPDATE artifact_gc_runs SET status='SWEEPING',marked=$3 WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId, rows.rowCount]); return rows.rows;
    });
    let swept = 0;
    for (const candidate of candidates) {
      const intent = await this.database.tenantTransaction(tenantId, "SERIALIZABLE", async (client) => {
      const guarded = await client.query(`SELECT artifact_digest,version,repository_id FROM artifact_manifests WHERE tenant_id=$1 AND manifest_digest=$2 AND version=$3
        AND status IN ('REVOKED','EXPIRED') AND legal_hold=false AND retain_until<$4
        AND NOT artifact_digest_has_other_live_reference(artifact_manifests.artifact_digest,$1,artifact_manifests.manifest_digest)
        FOR UPDATE`, [tenantId, candidate.manifest_digest, candidate.version, now]);
      if (!guarded.rowCount) return undefined; const intentId = randomUUID(); const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const fenced = await client.query(`UPDATE artifact_gc_candidates SET intent_id=$4,intent_fence=intent_fence+1,intent_expires_at=$5
        WHERE tenant_id=$1 AND run_id=$2 AND manifest_digest=$3 RETURNING intent_fence`, [tenantId, runId, candidate.manifest_digest, intentId, expiresAt]);
      return { digest: guarded.rows[0].artifact_digest as string, repositoryId: guarded.rows[0].repository_id as string,
        intentId, expiresAt, fencingToken: Number(fenced.rows[0].intent_fence) };
      });
      if (!intent) continue; const ref = digestReference({ uri: `cas://sha256/${intent.digest}`, sha256: intent.digest });
      const client = await this.database.pool.connect();
      try { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [intent.digest]);
        const blocked = await client.query("SELECT artifact_digest_has_other_live_reference($1,$2,$3) AS blocked", [intent.digest, tenantId, candidate.manifest_digest]);
        if (blocked.rows[0]?.blocked) { await client.query("ROLLBACK"); continue; }
        await this.cas.delete(ref, this.access.issueDelete({ tenantId: parseTenantId(tenantId), repositoryId: parseRepositoryId(intent.repositoryId), digest: intent.digest, intentId: intent.intentId, expiresAt: intent.expiresAt, fencingToken: intent.fencingToken }));
        const result = await client.query(`UPDATE artifact_manifests SET version=version+1,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND manifest_digest=$2
          AND version=$3 AND legal_hold=false RETURNING version`, [tenantId, candidate.manifest_digest, candidate.version]);
        if (!result.rowCount) throw new TypeError("GC_DELETE_INTENT_STALE");
        await client.query("UPDATE artifact_digest_references SET live=false,released_at=transaction_timestamp() WHERE tenant_id=$1 AND manifest_digest=$2", [tenantId, candidate.manifest_digest]);
        await client.query("UPDATE artifact_gc_candidates SET deleted_at=transaction_timestamp() WHERE tenant_id=$1 AND run_id=$2 AND manifest_digest=$3 AND intent_id=$4", [tenantId, runId, candidate.manifest_digest, intent.intentId]);
        await statusEvent(client, tenantId, candidate.manifest_digest, Number(result.rows[0].version), "DELETED", "unreachable retention-expired artifact swept", actor); await client.query("COMMIT"); swept++;
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
    }
    await this.database.tenantTransaction(tenantId, "SERIALIZABLE", (client) => client.query("UPDATE artifact_gc_runs SET status='COMPLETED',swept=$3,completed_at=transaction_timestamp() WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId, swept]).then(() => undefined));
    return { marked: candidates.length, swept };
  }
  async reconcilePendingGcIntents(tenantId: string, actor: string, now = new Date()): Promise<{ marked: number; swept: number }> {
    await this.database.tenantTransaction(tenantId, "SERIALIZABLE", async (client) => {
      await client.query(`UPDATE artifact_gc_runs r SET status='ABORTED',completed_at=transaction_timestamp()
        WHERE r.tenant_id=$1 AND r.status IN ('MARKING','SWEEPING') AND EXISTS (
          SELECT 1 FROM artifact_gc_candidates c WHERE c.tenant_id=r.tenant_id AND c.run_id=r.run_id
          AND c.intent_id IS NOT NULL AND c.deleted_at IS NULL AND c.intent_expires_at<=$2)`, [tenantId, now]);
    });
    return this.garbageCollect(tenantId, `${actor}:gc-reconcile`, now);
  }
}
async function statusEvent(client: pg.PoolClient, tenantId: string, digest: string, version: number, status: string, reason: string, actor: string) {
  await client.query("INSERT INTO artifact_status_events(tenant_id,manifest_digest,event_version,status,reason,actor) VALUES($1,$2,$3,$4,$5,$6)", [tenantId, digest, version, status, reason, actor]);
}
