-- Order 7 — ghost auto-offline: a courier who repeatedly leaves offers to
-- expire (never responds — a "ghost", distinct from an honest decline) is
-- quietly eating dispatch waves other couriers could have taken. At N=3
-- CONSECUTIVE ignored (expired, not declined) offers, the sweeper demotes
-- them offline itself — mirroring set_courier_online_status('offline')'s
-- state changes exactly, since the cron has no auth.uid() to go through the
-- RPC.
--
-- Declines NEVER count towards the streak and NEVER get penalized here — an
-- honest "no" is the anonymity invariant's whole point (20260727001300).
-- Only an accept, or the courier manually toggling back online, resets it.

alter table public.couriers
  add column if not exists consecutive_ignored_offers integer not null default 0
  check (consecutive_ignored_offers >= 0);

-- Recreated from the CURRENT DB body (20260717001600/002000), extended with
-- the ghost-streak counter + auto-offline demotion.
create or replace function public.expire_dispatch_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count int := 0;
  v_streak int;
  v_courier_user uuid;
begin
  for v_rec in
    with expired as (
      update public.dispatch_offers
      set status = 'expired', responded_at = now()
      where status = 'offered' and expires_at < now()
      returning order_id, courier_id
    ) select order_id, courier_id from expired
  loop
    -- Ghost streak: count this ignored offer. Declines are a different
    -- status and never pass through this branch, so they structurally never
    -- count — no separate exclusion needed.
    update public.couriers
    set consecutive_ignored_offers = consecutive_ignored_offers + 1
    where id = v_rec.courier_id
    returning consecutive_ignored_offers into v_streak;

    if v_streak >= 3 then
      -- Mirrors set_courier_online_status('offline')'s state changes
      -- EXACTLY: close the open shift, decline any live offer, status
      -- offline. Implemented inline/SECURITY DEFINER — no auth.uid() here.
      update public.courier_shifts set ended_at = now()
      where courier_id = v_rec.courier_id and ended_at is null;

      update public.dispatch_offers set status = 'declined', responded_at = now()
      where courier_id = v_rec.courier_id and status = 'offered';

      update public.couriers set status = 'offline', consecutive_ignored_offers = 0
      where id = v_rec.courier_id
      returning user_id into v_courier_user;

      if v_courier_user is not null then
        insert into public.notification_outbox (user_id, title, body, url, tag)
        values (
          v_courier_user,
          'Trecut offline automat',
          'Te-am trecut offline după 3 oferte ratate — revino online când ești gata.',
          '/deliveries',
          'dispatch'
        );
      end if;
    end if;

    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when unique_violation then null; -- one collision must not abort the whole tick
    end;
    v_count := v_count + 1;
  end loop;

  for v_rec in
    select o.id as order_id from public.orders o
    where o.status = 'ready_for_pickup' and o.courier_id is null
      and not exists (select 1 from public.dispatch_offers d
                      where d.order_id = o.id and d.status = 'offered')
  loop
    begin
      perform public.dispatch_order(v_rec.order_id);
    exception when unique_violation then null;
    end;
  end loop;
  return v_count;
end;
$$;

-- A fresh accept proves the courier is actually engaged — breaks the streak.
create or replace function public.accept_dispatch_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_offer public.dispatch_offers%rowtype;
  v_courier_id uuid;
  v_order_id uuid;
begin
  select id into v_courier_id from public.couriers where user_id = auth.uid() and is_active;
  if v_courier_id is null then raise exception 'not an active courier'; end if;
  perform 1 from public.couriers where id = v_courier_id for update;                 -- (1) courier

  select order_id into v_order_id from public.dispatch_offers where id = p_offer_id;
  if v_order_id is null then raise exception 'offer not found'; end if;
  perform 1 from public.orders where id = v_order_id for update;                     -- (2) order

  select * into v_offer from public.dispatch_offers where id = p_offer_id for update; -- (3) offer
  if not found or v_offer.courier_id <> v_courier_id then raise exception 'offer not found'; end if;
  if v_offer.status = 'accepted' then return; end if;
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'oferta a expirat'; end if;
  if not public.courier_has_capacity(v_courier_id) then raise exception 'you already have an active delivery'; end if;

  update public.orders
  set status = 'courier_assigned', courier_id = v_courier_id
  where id = v_offer.order_id and status = 'ready_for_pickup' and courier_id is null;
  if not found then raise exception 'comanda nu mai este disponibila'; end if;

  update public.dispatch_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update public.couriers set status = 'on_delivery', consecutive_ignored_offers = 0 where id = v_courier_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_offer.order_id, 'courier_assigned', 'courier', auth.uid());
end;
$$;

-- A manual online reset also breaks the streak — a fresh start, same as a
-- human admin reinstating a courier resets their standing.
create or replace function public.set_courier_online_status(p_status text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_courier public.couriers%rowtype;
  v_policy public.cash_policy;
begin
  if p_status not in ('offline', 'online') then raise exception 'invalid status'; end if;
  select * into v_courier from public.couriers where user_id = auth.uid() and is_active for update;
  if not found then raise exception 'not an active courier'; end if;
  if v_courier.status = 'on_delivery' then
    raise exception 'ai o livrare activă — finalizeaz-o înainte să schimbi statusul';
  end if;

  if v_courier.status = p_status then
    return;
  end if;

  if p_status = 'online' then
    v_policy := public.current_cash_policy();
    if v_policy.reactivation_threshold_mdl is not null
       and public.courier_cash_balance(v_courier.id) >= v_policy.reactivation_threshold_mdl then
      raise exception 'Plafon numerar atins — predă încasările înainte să revii online.';
    end if;
    insert into public.courier_shifts (courier_id, started_at) values (v_courier.id, now());
  else
    update public.courier_shifts set ended_at = now()
    where courier_id = v_courier.id and ended_at is null;
  end if;

  -- Ghost auto-offline streak (this migration): a manual online reset is a
  -- fresh start, same as an accept.
  update public.couriers
  set status = p_status,
      consecutive_ignored_offers = case when p_status = 'online' then 0 else consecutive_ignored_offers end
  where id = v_courier.id;

  if p_status = 'offline' then
    update public.dispatch_offers set status = 'declined', responded_at = now()
    where courier_id = v_courier.id and status = 'offered';
  end if;
end;
$$;
