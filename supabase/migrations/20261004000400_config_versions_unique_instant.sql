-- The versioned config tables resolve "the version in effect at T" with
-- `order by effective_from desc limit 1`. Two versions at the SAME instant had no defined winner:
-- the payout (pricing_config_at) took one row, the courier app and web (shared-domain pctAt) the
-- other — 12.78 MDL apart per order on a 50 MDL fee, reproduced through set_pricing_config by the
-- money verifier (2026-10-04). One version per instant makes every reader agree. A correction is
-- still a new row, at a later instant.
create unique index pricing_config_effective_from_key on public.pricing_config (effective_from);
create unique index cash_policy_effective_from_key on public.cash_policy (effective_from);
create unique index courier_tariff_config_effective_from_key on public.courier_tariff_config (effective_from);
create unique index dispatch_scoring_config_effective_from_key on public.dispatch_scoring_config (effective_from);
