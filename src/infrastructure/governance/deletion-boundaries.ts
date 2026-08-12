import type { PostgresPersistence } from "../../persistence/postgres.js";
import { canonicalJson } from "../../shared-kernel/immutable.js";
import { digestBytes } from "../../shared-kernel/digest.js";
import type { DeletionBoundary, DeletionCategory, DeletionResult, DeletionTombstone } from "../../contexts/governance/application/privacy-boundaries.js";

type Counts = Readonly<{ removed: number; retained: number; held: number }>;

/** Concrete deletion boundaries for storage owned by this service. Remote Brain and backup
 * providers deliberately remain retention obligations until their owning adapters are installed. */
export function serviceDeletionBoundaries(database: PostgresPersistence, scopedMemory: ScopedBoundaryRegistry = new ScopedBoundaryRegistry()): readonly DeletionBoundary[] {
  return Object.freeze([
    postgresBoundary(database, "DATABASE", deleteDatabaseProjections),
    postgresBoundary(database, "EVENT", deleteEventData),
    postgresBoundary(database, "ARTIFACT", deleteArtifactReferences),
    scopedMemory.boundary("CACHE"), scopedMemory.boundary("KEY"),
    obligationBoundary("VECTOR"), obligationBoundary("BACKUP_OBLIGATION")
  ]);
}

export class ScopedBoundaryRegistry {
  readonly #entries = new Map<"CACHE" | "KEY", Set<string>>([["CACHE",new Set()], ["KEY",new Set()]]);
  add(category: "CACHE" | "KEY", tenantId: string, repositoryId: string, value: string): void { this.#entries.get(category)!.add(`${tenantId}\0${repositoryId}\0${value}`); }
  size(category: "CACHE" | "KEY", tenantId: string, repositoryId: string): number { const prefix=`${tenantId}\0${repositoryId}\0`; return [...this.#entries.get(category)!].filter(value=>value.startsWith(prefix)).length; }
  boundary(category: "CACHE" | "KEY"): DeletionBoundary { return verifiedBoundary(category, async tombstone => {
    const entries=this.#entries.get(category)!; const prefix=`${tombstone.tenantId}\0${tombstone.repositoryId}\0`; let removed=0;
    for(const value of [...entries]) if(value.startsWith(prefix)){entries.delete(value);removed++;} return {removed,retained:0,held:0};
  }); }
}

function postgresBoundary(database: PostgresPersistence, category: DeletionCategory, operation: (client: any,tombstone:DeletionTombstone)=>Promise<Counts>): DeletionBoundary {
  return verifiedBoundary(category, tombstone => database.tenantTransaction(tombstone.tenantId,"SERIALIZABLE",client=>operation(client,tombstone)));
}
function obligationBoundary(category: "VECTOR" | "BACKUP_OBLIGATION"): DeletionBoundary { return verifiedBoundary(category, async()=>({removed:0,retained:1,held:0})); }
function verifiedBoundary(category: DeletionCategory, operation: (tombstone:DeletionTombstone)=>Promise<Counts>): DeletionBoundary {
  return Object.freeze({ category, async delete(tombstone:DeletionTombstone,operationKey:string){return result(category,tombstone,operationKey,await operation(tombstone));},
    async verify(value:DeletionResult){return value.category===category && value.acknowledgementDigest===acknowledgement(value);} });
}
function result(category:DeletionCategory,tombstone:DeletionTombstone,operationKey:string,counts:Counts):DeletionResult {
  const base={category,operationKey,tenantId:tombstone.tenantId,repositoryId:tombstone.repositoryId,requestId:tombstone.requestId,...counts};
  const digest=digestBytes(new TextEncoder().encode(canonicalJson(base))); const value={...base,digest};
  return Object.freeze({...value,acknowledgementDigest:acknowledgement(value)});
}
function acknowledgement(value:Omit<DeletionResult,"acknowledgementDigest">|DeletionResult):string { const {acknowledgementDigest:_discard,...body}=value as DeletionResult;return digestBytes(new TextEncoder().encode(canonicalJson(body))); }

async function deleteDatabaseProjections(client:any,t:DeletionTombstone):Promise<Counts>{
  const row=(await client.query("SELECT privacy_delete_database($1,$2) AS removed",[t.tenantId,t.repositoryId])).rows[0];return {removed:Number(row.removed),retained:0,held:0};
}
async function deleteEventData(client:any,t:DeletionTombstone):Promise<Counts>{
  const row=(await client.query("SELECT privacy_delete_events($1,$2) AS removed",[t.tenantId,t.repositoryId])).rows[0];return {removed:Number(row.removed),retained:0,held:0};
}
async function deleteArtifactReferences(client:any,t:DeletionTombstone):Promise<Counts>{
  const row=(await client.query("SELECT * FROM privacy_release_artifact_refs($1,$2)",[t.tenantId,t.repositoryId])).rows[0];return {removed:Number(row.removed),retained:Number(row.held),held:Number(row.held)};
}
