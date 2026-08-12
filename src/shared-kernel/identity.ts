const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

declare const identityBrand: unique symbol;
export type ScopedId<K extends string> = string & { readonly [identityBrand]: K };
export type TenantId = ScopedId<"TenantId">;
export type RepositoryId = ScopedId<"RepositoryId">;
export type AggregateId = ScopedId<"AggregateId">;
export type CycleId = ScopedId<"CycleId">;
export type ActorId = ScopedId<"ActorId">;

function parseId<K extends string>(value: string, kind: K): ScopedId<K> {
  if (!ID_PATTERN.test(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new TypeError(`${kind} must be 1-128 lowercase ASCII identifier characters`);
  }
  return value as ScopedId<K>;
}

export const tenantId = (value: string): TenantId => parseId(value, "TenantId");
export const repositoryId = (value: string): RepositoryId => parseId(value, "RepositoryId");
export const aggregateId = (value: string): AggregateId => parseId(value, "AggregateId");
export const cycleId = (value: string): CycleId => parseId(value, "CycleId");
export const actorId = (value: string): ActorId => parseId(value, "ActorId");

export interface AggregateIdentity {
  readonly tenantId: TenantId;
  readonly repositoryId: RepositoryId;
  readonly aggregateId: AggregateId;
}

export function sameScope(left: AggregateIdentity, right: AggregateIdentity): boolean {
  return left.tenantId === right.tenantId && left.repositoryId === right.repositoryId;
}
