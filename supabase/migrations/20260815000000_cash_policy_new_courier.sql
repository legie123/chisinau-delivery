-- Simulare pilot 5×5×15 (2026-08-15): la 75 comenzi/zi cu 5 curieri, plafonul
-- de numerar — nu capacitatea — e frâna. Cu plafonul de „curier nou" (1000 MDL)
-- pilotul pierde 5,9% din comenzi și curierii ard 24% din timpul ocupat în
-- drumuri la sediu; la plafonul plin (1500) pierderea scade la 1,5%.
--
-- Problema de proiectare: acele „1000 MDL" și „30 de zile" erau HARDCODATE în
-- effective_cash_cap, iar la lansare TOȚI curierii sunt sub 30 de zile — deci
-- 100% din flotă pornește pe regimul restrictiv, iar reglarea cerea migrație.
-- Aici doar le facem configurabile, versionat, PĂSTRÂND valorile de azi:
-- decizia de risc (cât numerar ține un curier nou) rămâne a proprietarului, nu
-- a unei migrații. `new_courier_days = 0` dezactivează complet perioada de probă.

alter table public.cash_policy
  add column if not exists new_courier_cap_mdl numeric(8,2) not null default 1000,
  add column if not exists new_courier_days int not null default 30;

alter table public.cash_policy
  drop constraint if exists cash_policy_new_courier_cap_check,
  add constraint cash_policy_new_courier_cap_check check (new_courier_cap_mdl > 0);
alter table public.cash_policy
  drop constraint if exists cash_policy_new_courier_days_check,
  add constraint cash_policy_new_courier_days_check check (new_courier_days >= 0);

comment on column public.cash_policy.new_courier_cap_mdl is
  'Plafon de numerar pentru curierii mai noi de new_courier_days. Se aplică prin least() cu cap_mdl.';
comment on column public.cash_policy.new_courier_days is
  'Durata regimului de curier nou, în zile. 0 = fără perioadă de probă (toți pe cap_mdl).';

create or replace function public.effective_cash_cap(p_courier_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.cash_policy;
  v_created_at timestamptz;
begin
  v_policy := public.current_cash_policy();
  if v_policy.cap_mdl is null then
    return null;
  end if;

  select created_at into v_created_at from public.couriers where id = p_courier_id;

  -- Regimul de curier nou: configurabil prin versiunea de politică activă.
  if v_policy.new_courier_days > 0
     and v_created_at is not null
     and v_created_at > now() - make_interval(days => v_policy.new_courier_days) then
    return least(v_policy.cap_mdl, v_policy.new_courier_cap_mdl);
  end if;

  return v_policy.cap_mdl;
end;
$$;

-- Setter-ul versionat capătă cei doi parametri, cu valorile de azi ca implicit,
-- deci apelurile existente (3-5 argumente) rămân valabile neschimbate.
-- ATENȚIE: în Postgres identitatea unei funcții e dată de tipurile parametrilor,
-- iar cei cu DEFAULT nu contează — `create or replace` cu 7 parametri ar lăsa
-- versiunea veche de 5 în viață și orice apel cu 5 argumente ar deveni ambiguu
-- („function ... is not unique", prins de sim 22). Vechea semnătură se șterge.
drop function if exists public.set_cash_policy(numeric, numeric, text, timestamptz, text);

create or replace function public.set_cash_policy(
  p_cap_mdl numeric, p_reactivation_mdl numeric, p_offload_text text,
  p_effective_from timestamptz default now(), p_note text default null,
  p_new_courier_cap_mdl numeric default 1000, p_new_courier_days int default 30
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  insert into public.cash_policy (cap_mdl, reactivation_threshold_mdl, offload_channel_text,
                                  effective_from, note, created_by,
                                  new_courier_cap_mdl, new_courier_days)
  values (p_cap_mdl, p_reactivation_mdl, p_offload_text, p_effective_from, p_note, auth.uid(),
          p_new_courier_cap_mdl, p_new_courier_days)
  returning id into v_id;
  return v_id;
end;
$$;

-- Bug de încredere descoperit de armata SPOF (2026-08-15): ambele funcții de
-- stare a numerarului raportau plafonul DIN POLITICĂ (cap_mdl), nu plafonul
-- EFECTIV al curierului. Un curier nou vedea „740 / 1500" și credea că mai are
-- 760 MDL de colectat, în timp ce dispatch-ul îl tăia deja la 1000 — refuzuri
-- inexplicabile exact în ziua în care are cea mai mare nevoie de încredere.
-- La lansare toți curierii sunt „noi", deci toți ar vedea cifra greșită.
create or replace function public.get_courier_cash_status()
returns table(balance_mdl numeric, cap_mdl numeric, reactivation_threshold_mdl numeric, offload_channel_text text)
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_courier_id uuid := public.current_courier_id();
  v_policy public.cash_policy;
begin
  if v_courier_id is null then raise exception 'not a courier'; end if;
  v_policy := public.current_cash_policy();
  return query select public.courier_cash_balance(v_courier_id),
                      public.effective_cash_cap(v_courier_id),
                      v_policy.reactivation_threshold_mdl,
                      v_policy.offload_channel_text;
end;
$$;

create or replace function public.admin_courier_cash_status(p_courier_id uuid)
returns table(balance_mdl numeric, cap_mdl numeric, reactivation_threshold_mdl numeric, offload_channel_text text)
language plpgsql security definer set search_path = public, auth
as $$
declare v_policy public.cash_policy;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  v_policy := public.current_cash_policy();
  return query select public.courier_cash_balance(p_courier_id),
                      public.effective_cash_cap(p_courier_id),
                      v_policy.reactivation_threshold_mdl,
                      v_policy.offload_channel_text;
end;
$$;
