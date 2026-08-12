# ADR-020: Multi-tenant privacy and retention

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: privacy, tenancy, retention, deletion

## Context

Agent trajectories and repository evidence may contain source code, personal data, secrets, or regulated information. Audit retention and deletion obligations can conflict.

## Decision

Classify every field/artifact as `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`, or `SECRET-PROHIBITED`. Enrollment declares allowed classes, region, retention profile, and model-provider policy.

- Data minimization and redaction occur before persistence/model use.
- Tenant isolation is enforced in identity, PostgreSQL, CAS, queues, vector namespaces, caches, keys, logs, metrics, and support tools.
- Default retention: scratch 7 days, raw observations 30, candidate failures 90, successful lineage/evaluation 400, security/audit 400; tenant/legal profiles may increase or decrease within policy.
- Secrets are prohibited and quarantined, then removed through an audited purge workflow.
- Deletion uses a tenant/repository tombstone, stops new processing, revokes access, removes projections and eligible objects, and retains only non-sensitive digests required for integrity/legal obligations.
- External model calls honor residency and training opt-out requirements; restricted data defaults to approved private/local providers only.

Privacy exports and deletions are authorized, idempotent, observable jobs with completion receipts.

## Acceptance criteria

1. Cross-tenant and cache/metrics side-channel suites pass.
2. Redaction/secret fixtures never reach model or durable normal storage.
3. Retention and deletion clocks are testable with simulated time.
4. A deletion receipt enumerates removed, retained, and legally held categories without exposing content.
5. Backup expiration and vector/index deletion are included, not only primary rows.

## Links

- [ADR-006](ADR-006-policy-security-and-tenancy.md)
- [ADR-014](ADR-014-content-addressed-artifact-lifecycle.md)
