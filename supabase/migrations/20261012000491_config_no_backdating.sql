-- Money/ops config versions cannot be backdated through the API.
-- Payouts read the commission of the pricing_config version in effect at each order's delivered_at
-- (pricing_config_at). set_pricing_config (and set_courier_tariff, set_cash_policy,
-- set_dispatch_scoring_config) accepted any p_effective_from, so a version dated last month silently
-- re-priced every delivered-but-unpaid order since then (sim 292: commission 3 days ago 15 -> 55).
-- A BEFORE INSERT trigger on the four versioned tables refuses an effective_from more than 5 minutes
-- in the past (clock skew) when the insert comes through the API (a JWT is present). Migrations and
-- seeds (no JWT) may still write historical rows. The RPCs are unchanged.

create or replace function public.refuse_backdated_config() returns trigger
language plpgsql set search_path = public as $$
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and new.effective_from < now() - interval '5 minutes' then
    raise exception 'O versiune nouă nu poate începe în trecut (%). Alege acum sau o dată viitoare; istoricul nu se rescrie.',
      to_char(new.effective_from at time zone 'Europe/Chisinau', 'DD.MM.YYYY HH24:MI');  -- P0001: shared-api passes Romanian text through
  end if;
  return new;
end $$;
revoke all on function public.refuse_backdated_config() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['pricing_config', 'courier_tariff_config', 'cash_policy', 'dispatch_scoring_config'] loop
    execute format('drop trigger if exists refuse_backdated_config on public.%I', t);
    execute format('create trigger refuse_backdated_config before insert on public.%I
                    for each row execute function public.refuse_backdated_config()', t);
  end loop;
end $$;
