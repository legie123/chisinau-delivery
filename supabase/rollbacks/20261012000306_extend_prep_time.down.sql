-- Rollback of 20261012000306. Ready times already extended stay as they are.
drop function if exists public.extend_prep_time(uuid, int);
