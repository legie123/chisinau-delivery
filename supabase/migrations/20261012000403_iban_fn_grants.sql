-- is_valid_iban (20261012000402) was created with the default EXECUTE for PUBLIC, so anon could
-- call it: sims 73.a4 and 80.7 flag every public function outside the allow-list. It is a pure
-- checksum, but the rule is explicit grants: authenticated (apps may pre-validate) + service_role.
-- The CHECK on payout_accounts keeps working: rows are written by set_payout_account (definer).
revoke execute on function public.is_valid_iban(text) from public, anon;
grant execute on function public.is_valid_iban(text) to authenticated, service_role;
