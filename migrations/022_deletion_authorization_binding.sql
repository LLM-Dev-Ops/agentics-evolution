ALTER TABLE governance_deletion_tombstones ADD COLUMN approval_binding jsonb;
ALTER TABLE governance_deletion_tombstones ADD CONSTRAINT deletion_approval_binding_required CHECK(approval_binding IS NOT NULL) NOT VALID;
