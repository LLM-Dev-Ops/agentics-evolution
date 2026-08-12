# Prompt 03 messaging recovery runbook

This runbook covers the PostgreSQL transactional outbox, Pub/Sub poison handling, dead-letter inspection, and authorized redrive defined by ADR-011 and ADR-013. Run all database commands using the tenant-scoped operations role; migration credentials are prohibited.

## Stuck outbox

1. Alert when the oldest unpublished, non-dead-lettered row exceeds five minutes or the pending depth grows for ten minutes.
2. Inspect `attempts`, `first_attempt_at`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, and `last_error_code` for the affected tenant. Do not modify envelope bytes or event identity.
3. Confirm Pub/Sub health and relay process health. Restarting a relay is safe: expired leases are reclaimed and broker acknowledgement ambiguity may create a physical duplicate, while inbox identity prevents another logical effect.
4. Abort if tenant scope, envelope digest, or ordering key is inconsistent. Quarantine as a security incident rather than redriving.

## Dead-letter inspection and redrive

1. Query `dead_letters` by tenant, event ID, reason, age, and source topic. Verify the original envelope, repository, aggregate, correlation, causation, trace context, attempt count, and payload digest.
2. Correct the external condition. Never alter a dead-lettered envelope in place. A corrected logical event requires a new event ID and a `supersedes` reference.
3. Obtain a signed, tenant/event-scoped redrive capability from Governance. The capability must be unexpired and restricted to the recorded source topic.
4. Invoke the redrive application command. It increments `redrive_count`, preserves the original record, clears terminal outbox state, and schedules immediate retry.
5. Confirm one logical inbox effect. If the same poison condition recurs, it returns to DLQ; stop after the configured terminal attempt and investigate rather than looping.

## Migration interruption

Migrations run only from the release job under an advisory lock. Each SQL migration and checksum ledger insertion share one transaction. After interruption, rerun the identical release artifact; checksum drift is a hard stop. Do not edit an applied migration. Expand schema before deploying new writers, verify old and new writers concurrently, and authorize contract removal only after the predecessor version is absent.

## Abort criteria

Stop recovery and escalate if RLS is disabled, a runtime role has `SUPERUSER` or `BYPASSRLS`, an append-only event differs from its signed source, a dead letter crosses tenant/repository scope, or observed committed state lacks its event/outbox record.
