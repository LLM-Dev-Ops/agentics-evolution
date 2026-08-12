export const contextNames = [
  "observation", "dream", "evolution", "evaluation", "governance",
  "operations", "brain-knowledge", "repository-integration",
  "artifact-lineage", "evaluation-corpus"
] as const;

export type ContextName = typeof contextNames[number];

export interface ContextDescriptor {
  readonly name: ContextName;
  readonly aggregate: string;
}

export interface AggregateScope<TTenantId = TenantId, TRepositoryId = RepositoryId> {
  readonly tenantId: TTenantId;
  readonly repositoryId: TRepositoryId;
  readonly aggregateId: AggregateId;
}

export function hasAggregateScope(value: Partial<AggregateScope>): value is AggregateScope {
  return value.tenantId !== undefined && value.repositoryId !== undefined && value.aggregateId !== undefined;
}

export function assertSameAggregateScope(
  expected: AggregateScope,
  actual: AggregateScope
): void {
  if (expected.tenantId !== actual.tenantId || expected.repositoryId !== actual.repositoryId || expected.aggregateId !== actual.aggregateId) {
    throw new TypeError("aggregate tenant/repository scope mismatch");
  }
}

export type ScopedAggregate = AggregateIdentity;
import type { AggregateId, AggregateIdentity, RepositoryId, TenantId } from "../shared-kernel/identity.js";
