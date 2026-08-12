import pg from "pg";
import type { EvolutionEnvelope } from "../shared-kernel/evolution-envelope.js";
import { canonicalJson } from "../shared-kernel/immutable.js";
import { digestBytes } from "../shared-kernel/digest.js";
const { Pool } = pg;

export interface PersistenceConfig { readonly connectionString: string; readonly maxConnections: number; readonly statementTimeoutMs: number; readonly lockTimeoutMs: number;
  readonly enforceRuntimeRole?: boolean; }
export interface CommandWrite { readonly aggregateType: string; readonly expectedVersion: number; readonly state: Readonly<Record<string, unknown>>; readonly event: EvolutionEnvelope; readonly topic: "evolution.commands.v1" | "evolution.events.v1"; readonly traceparent?: string; }
export interface CommandResult { readonly eventId: string; readonly aggregateVersion: number; readonly duplicate: boolean; }

export class PostgresPersistence {
  readonly pool: pg.Pool;
  readonly #statementTimeoutMs: number;
  readonly #lockTimeoutMs: number;
  readonly #enforceRuntimeRole: boolean;
  #runtimeVerified?: Promise<void>;
  constructor(config: PersistenceConfig) {
    this.pool = new Pool({ connectionString: config.connectionString, max: config.maxConnections, allowExitOnIdle: true });
    this.#statementTimeoutMs = config.statementTimeoutMs; this.#lockTimeoutMs = config.lockTimeoutMs; this.#enforceRuntimeRole = config.enforceRuntimeRole ?? true;
  }
  async close(): Promise<void> { await this.pool.end(); }
  async verifyRuntimeSafety(): Promise<void> {
    const result = await this.pool.query(`SELECT r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'agentics_app','member') AS app_member
      FROM pg_roles r WHERE r.rolname=current_user`);
    const role = result.rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || !role.app_member) throw new Error("UNSAFE_POSTGRES_RUNTIME_ROLE");
  }
  async tenantTransaction<T>(tenant: string, isolation: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE", operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (this.#enforceRuntimeRole) await (this.#runtimeVerified ??= this.verifyRuntimeSafety());
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      await client.query("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)", [`${this.#statementTimeoutMs}ms`, `${this.#lockTimeoutMs}ms`]);
      const result = await operation(client); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async executeCommand(write: CommandWrite): Promise<CommandResult> {
    const envelope = write.event; const requestDigest = digestBytes(new TextEncoder().encode(canonicalJson({ expectedVersion: write.expectedVersion, state: write.state, event: envelope })));
    return withSerializableRetry(() => this.tenantTransaction(envelope.tenantId, "SERIALIZABLE", async (client) => {
      const existing = await client.query<{ request_digest: string; response: CommandResult }>(
        "SELECT request_digest,response FROM command_idempotency WHERE tenant_id=$1 AND idempotency_key=$2", [envelope.tenantId, envelope.idempotencyKey]);
      if (existing.rowCount) {
        const prior = existing.rows[0];
        if (!prior || prior.request_digest !== requestDigest) throw Object.assign(new Error("IDEMPOTENCY_CONFLICT"), { code: "23505" });
        return { ...prior.response, duplicate: true };
      }
      const nextVersion = write.expectedVersion + 1;
      const updated = write.expectedVersion === 0
        ? await client.query("INSERT INTO aggregates(tenant_id,repository_id,aggregate_id,aggregate_type,version,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING version",
          [envelope.tenantId, envelope.repositoryId, envelope.aggregateId, write.aggregateType, nextVersion, write.state])
        : await client.query("UPDATE aggregates SET version=$5,state=$6,updated_at=transaction_timestamp() WHERE tenant_id=$1 AND repository_id=$2 AND aggregate_id=$3 AND aggregate_type=$4 AND version=$7 RETURNING version",
          [envelope.tenantId, envelope.repositoryId, envelope.aggregateId, write.aggregateType, nextVersion, write.state, write.expectedVersion]);
      if (updated.rowCount !== 1) throw Object.assign(new Error("OPTIMISTIC_CONCURRENCY_CONFLICT"), { code: "40001" });
      await client.query("INSERT INTO domain_events(tenant_id,repository_id,aggregate_id,event_id,aggregate_version,event_type,envelope,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [envelope.tenantId, envelope.repositoryId, envelope.aggregateId, envelope.id, nextVersion, envelope.type, envelope, envelope.occurredAt]);
      const orderingKey = `${envelope.tenantId}/${envelope.repositoryId}/${envelope.aggregateId}`;
      await client.query("INSERT INTO outbox(tenant_id,event_id,repository_id,aggregate_id,topic,ordering_key,envelope,traceparent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [envelope.tenantId, envelope.id, envelope.repositoryId, envelope.aggregateId, write.topic, orderingKey, envelope, write.traceparent ?? null]);
      const response: CommandResult = { eventId: envelope.id, aggregateVersion: nextVersion, duplicate: false };
      await client.query("INSERT INTO command_idempotency(tenant_id,idempotency_key,request_digest,response) VALUES($1,$2,$3,$4)", [envelope.tenantId, envelope.idempotencyKey, requestDigest, response]);
      return response;
    }), { maxAttempts: 5, baseDelayMs: 5, deadlineMs: Date.now() + 5_000 });
  }
}

export async function withSerializableRetry<T>(operation: (attempt: number) => Promise<T>, options: { maxAttempts: number; baseDelayMs: number; deadlineMs: number; random?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<T> {
  const random = options.random ?? Math.random; const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) try { return await operation(attempt); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (!['40001', '40P01'].includes(code ?? "") || attempt === options.maxAttempts || Date.now() >= options.deadlineMs) throw error;
    await sleep(Math.floor(random() * options.baseDelayMs * 2 ** (attempt - 1)));
  }
  throw new Error("SERIALIZABLE_RETRY_EXHAUSTED");
}
