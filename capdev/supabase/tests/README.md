# Schema tests

Run against a scratch Postgres, never production. They assert that the rules
hold at the database layer, where nothing can bypass them:

- `01_audit_and_immutability.sql` — audit rows appear automatically on insert
  and update; audit rows cannot be updated or deleted; duplicate active role
  grants are rejected; a revoked grant does not block a new one.
- `02_row_level_security.sql` — signed-out sees zero rows everywhere; signed-in
  sees only their own organization; audit is invisible without `audit.read`;
  audit cannot be written through the API; tenants are isolated.

Note: `set_config(..., true)` is transaction-local, so JWT simulation must run
inside `begin/commit`. Outside a transaction psql autocommits and the setting is
discarded before the next statement — which silently makes every test look like
it passes for the wrong reason.
