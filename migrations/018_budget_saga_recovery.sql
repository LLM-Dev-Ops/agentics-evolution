ALTER TABLE budget_reservation_sagas ADD COLUMN operation_idempotency_key uuid;
ALTER TABLE budget_reservation_sagas ADD COLUMN last_error text;
CREATE INDEX budget_saga_reconcile_idx ON budget_reservation_sagas(updated_at) WHERE status='REQUESTED';
