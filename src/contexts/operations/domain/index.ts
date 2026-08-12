import type { AggregateScope } from "../../context-boundary.js";

export interface RepositoryEnrollmentBoundary extends AggregateScope {
  readonly aggregateKind: "RepositoryEnrollment";
}
