-- Master-audit §5 #16 (🔴, legal binding) — human-in-loop courier suspension.
--
-- EU Directive 2024/2831 Art 10(5): "Any decision to restrict, suspend or terminate
-- the contractual relationship or the account … shall be taken by a HUMAN BEING."
-- Art 11: the worker gets a written explanation + a review window. Art 7(1)(f) bans
-- 1:N biometric matching (handled elsewhere: KYC is 1:1 only).
--
-- Design: a suspension is ALWAYS a platform_admin (a human) calling suspend_courier
-- with a mandatory reason; it records who decided it + a contest deadline. The
-- fraud_flags queue stays signal-only — it NEVER auto-suspends. The suspended courier
-- can read their own suspension (the Art 11 explanation).

create table if not exists public.courier_suspensions (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  decided_by uuid not null references auth.users(id),   -- the HUMAN (Art 10(5))
  reason text not null,                                  -- the written explanation (Art 11)
  decided_at timestamptz not null default now(),
  appeal_deadline timestamptz not null,                  -- published contest window
  status text not null default 'active' check (status in ('active', 'reversed')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);
create index if not exists courier_suspensions_courier_idx on public.courier_suspensions (courier_id);

alter table public.courier_suspensions enable row level security;
drop policy if exists courier_suspensions_admin on public.courier_suspensions;
create policy courier_suspensions_admin on public.courier_suspensions for select using (has_role('platform_admin'));
-- Art 11 transparency: the courier reads their OWN suspension record.
drop policy if exists courier_suspensions_self on public.courier_suspensions;
create policy courier_suspensions_self on public.courier_suspensions for select
  using (courier_id = public.current_courier_id());

-- Suspend: HUMAN admin only, mandatory reason, records the decision + contest window,
-- deactivates the courier and cancels their live offers. NEVER called automatically.
create or replace function public.suspend_courier(p_courier_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'motivul suspendării este obligatoriu (Art. 11)'; end if;
  if not exists (select 1 from public.couriers where id = p_courier_id) then raise exception 'courier not found'; end if;

  insert into public.courier_suspensions (courier_id, decided_by, reason, appeal_deadline)
  values (p_courier_id, auth.uid(), btrim(p_reason), now() + interval '6 months')
  returning id into v_id;

  update public.couriers set is_active = false, status = 'offline' where id = p_courier_id;
  update public.dispatch_offers set status = 'cancelled', responded_at = now()
  where courier_id = p_courier_id and status = 'offered';

  return v_id;
end;
$$;
revoke execute on function public.suspend_courier(uuid, text) from public, anon;
grant execute on function public.suspend_courier(uuid, text) to authenticated;

-- Reinstate: HUMAN admin upholds an appeal / lifts the suspension.
create or replace function public.reinstate_courier(p_courier_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  update public.courier_suspensions
    set status = 'reversed', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now()
  where courier_id = p_courier_id and status = 'active';

  update public.couriers set is_active = true where id = p_courier_id;
end;
$$;
revoke execute on function public.reinstate_courier(uuid, text) from public, anon;
grant execute on function public.reinstate_courier(uuid, text) to authenticated;
