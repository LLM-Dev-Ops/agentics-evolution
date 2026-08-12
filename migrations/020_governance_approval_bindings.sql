ALTER TABLE governance_authorizations ADD COLUMN approved_binding jsonb;
ALTER TABLE governance_authorizations ADD CONSTRAINT governance_approved_binding_state CHECK (
  (state = 'REQUESTED' AND approved_binding IS NULL) OR (state <> 'REQUESTED' AND (state = 'DENIED' OR approved_binding IS NOT NULL))
) NOT VALID;
