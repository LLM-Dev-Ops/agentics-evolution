# ADR-021: GCP production topology and environments

- **Status**: proposed
- **Date**: 2026-08-11
- **Tags**: gcp, cloud-run, gke, infrastructure

## Context

ADR-008 names roles but not a deployable topology. Existing Agentics services predominantly target GCP, so a different platform would increase operational drift.

## Decision

Use dedicated GCP projects for development, staging, and production, managed through Terraform and organization policy.

| Role | Service |
|---|---|
| Control API and scheduler | private Cloud Run services, min instances in production |
| Outbox relay/reconcilers | Cloud Run services/jobs |
| Untrusted candidate/evaluator jobs | dedicated GKE Autopilot + GKE Sandbox |
| Transaction state | regional HA Cloud SQL PostgreSQL 16 |
| Event transport | Pub/Sub with dead-letter topics |
| Immutable artifacts | GCS with CMEK/versioning/retention |
| Keys/secrets | Cloud KMS and Secret Manager |
| Telemetry | OpenTelemetry to Cloud Logging/Monitoring/Trace and observatory |
| Schedule trigger | Cloud Scheduler to private authenticated endpoint |

Private VPC connectivity, Serverless VPC Access/Direct VPC egress, private service access, restricted ingress, Cloud Armor where public webhook ingress is required, and separate service accounts per role are mandatory. GitHub webhook ingress terminates at a minimal verified endpoint; all other APIs are private or identity-aware.

Terraform state is remote, versioned, locked, and separately authorized. Production has no developer owner roles. Configuration is schema-validated and promoted, not manually recreated.

## Acceptance criteria

1. Terraform plan/policy tests, drift detection, and clean-environment apply pass.
2. Network tests prove private services and sandbox restrictions.
3. Staging mirrors production topology with smaller capacity and distinct keys/data.
4. Regional failover, autoscaling, quota, and dependency exhaustion tests pass.
5. No unauthenticated Agentics Evolution endpoint exists except GitHub webhook verification ingress.

## Links

- [ADR-008](ADR-008-production-runtime-and-operations.md)
- [ADR-016](ADR-016-candidate-sandbox-and-network-isolation.md)
