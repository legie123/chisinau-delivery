-- Faza 5 #4 — referral de curieri: bonus la 50-100 comenzi în 30 de zile
-- (Economica.net: Glovo 10k+ curieri prin referral; PrimeCurier: Wolt 900 RON).
-- SIGNAL-ONLY: platforma doar contorizează și afișează progresul; plata bonusului
-- e decizie umană (admin), prin payout-ul existent — zero automatizare de bani.

-- 1. codul de recomandare al fiecărui curier (scurt, uman-citibil) + cine l-a adus
alter table public.couriers
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.couriers(id) on delete set null;

update public.couriers
  set referral_code = upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  where referral_code is null;
alter table public.couriers alter column referral_code set not null;
alter table public.couriers alter column referral_code
  set default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
create unique index if not exists couriers_referral_code_idx on public.couriers(referral_code);
create index if not exists couriers_referred_by_idx on public.couriers(referred_by);

-- 2. legarea: admin-only (se face la onboarding, când curierul nou spune cine
--    l-a recomandat), write-once, fără auto-recomandare
create or replace function public.set_courier_referrer(p_courier_id uuid, p_referrer_code text)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare v_ref uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select id into v_ref from public.couriers where referral_code = upper(trim(p_referrer_code));
  if v_ref is null then raise exception 'cod de recomandare inexistent'; end if;
  if v_ref = p_courier_id then raise exception 'un curier nu se poate recomanda singur'; end if;
  update public.couriers set referred_by = v_ref
  where id = p_courier_id and referred_by is null;
  if not found then
    raise exception 'curierul nu există sau are deja o recomandare înregistrată';
  end if;
end;
$$;
revoke execute on function public.set_courier_referrer(uuid, text) from public, anon;
grant execute on function public.set_courier_referrer(uuid, text) to authenticated;

-- 3. progresul: livrări în primele 30 de zile de la crearea contului recomandat.
--    security_invoker — admin vede tot (couriers admin-read); curierul își vede
--    propriile recomandări (self-read pe rândul referrer-ului nu există pe cel
--    recomandat → curierul vede doar rândurile unde el e referrer, prin politica
--    couriers_self_read aplicată pe r (referred) NU trece → deci doar admin vede
--    lista completă; e suficient pentru pilot (founder-operator).
create or replace view public.admin_referral_progress
with (security_invoker = on) as
select
  ref.id as referrer_id,
  ref.full_name as referrer_name,
  ref.referral_code,
  r.id as referred_id,
  r.full_name as referred_name,
  r.created_at as referred_joined_at,
  (select count(*) from public.orders o
    where o.courier_id = r.id and o.status = 'delivered'
      and o.delivered_at < r.created_at + interval '30 days') as delivered_30d,
  (now() > r.created_at + interval '30 days') as window_closed,
  (select count(*) from public.orders o
    where o.courier_id = r.id and o.status = 'delivered'
      and o.delivered_at < r.created_at + interval '30 days') >= 50 as qualified
from public.couriers r
join public.couriers ref on ref.id = r.referred_by;

revoke all on public.admin_referral_progress from anon;
grant select on public.admin_referral_progress to authenticated;
