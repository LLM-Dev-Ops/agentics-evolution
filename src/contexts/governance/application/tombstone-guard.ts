import type { RepositoryId, TenantId } from "../../../shared-kernel/identity.js";
export interface TombstoneGuard { assertWritesAllowed(tenantId: TenantId, repositoryId: RepositoryId): Promise<void>; }
