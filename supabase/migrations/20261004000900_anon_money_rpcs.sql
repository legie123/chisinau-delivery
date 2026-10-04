-- Round-5 audit of the cross-app E2E (2026-10-04): an UNAUTHENTICATED caller, holding only the public
-- anon key and an order id (ids travel in URLs and push payloads), could rewrite another customer's
-- tip and total (set_order_tip) and flip its payment_status / create a payment intent
-- (start_online_payment). Two causes, both fixed:
--  1. NULL-unsafe ownership guard: `v_order.customer_id <> auth.uid()` is NULL when auth.uid() is
--     null, plpgsql treats NULL as false, so the "not authorized" raise was skipped. Same pattern in
--     confirm_catering_quote, confirm_venue_booking, cancel_venue_booking, submit_rating (not
--     anon-reachable today only because of their grants). Each is recreated from its LIVE body with
--     one mechanical delta: `<> auth.uid()` -> `is distinct from auth.uid()` (every occurrence).
--  2. anon kept EXECUTE: 20261004000100 turned the implicit PUBLIC execute into explicit grants, so
--     functions that were reachable by anon through PUBLIC stayed reachable. Revoked here for every
--     function that needs a signed-in user (the policy helpers has_role / has_restaurant_access ...
--     and the public read RPCs keep anon: RLS policies evaluated for anon call them).
-- set_order_tip: 1× `<> auth.uid()` -> `is distinct from auth.uid()`
CREATE OR REPLACE FUNCTION public.set_order_tip(p_order_id uuid, p_tip_mdl numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_order public.orders%rowtype; v_new_tip numeric(10,2); v_new_total numeric(10,2);
begin
  if p_tip_mdl is null or p_tip_mdl < 0 then raise exception 'invalid tip'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status in ('delivered', 'cancelled', 'rejected') then raise exception 'too late to tip'; end if;
  -- #1/#34: an online charge is already captured — the total is locked to what was
  -- collected. (Cash/card_on_delivery collect at handover, so they stay editable.)
  if v_order.payment_method = 'online_gateway' and v_order.payment_status = 'paid' then
    raise exception 'bacșișul nu mai poate fi modificat după ce plata online a fost efectuată';
  end if;

  v_new_tip := round(p_tip_mdl, 2);
  v_new_total := v_order.total_mdl - coalesce(v_order.tip_mdl, 0) + v_new_tip;
  update public.orders set tip_mdl = v_new_tip, total_mdl = v_new_total where id = p_order_id;
  update public.payment_intents
  set amount_mdl = v_new_total, updated_at = now()
  where order_id = p_order_id and status = 'pending';
end; $function$;

-- start_online_payment: 1× `<> auth.uid()` -> `is distinct from auth.uid()`
CREATE OR REPLACE FUNCTION public.start_online_payment(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_order public.orders%rowtype; v_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.payment_status = 'paid' then raise exception 'already paid'; end if;
  select id into v_id from public.payment_intents where order_id = p_order_id and status = 'pending' limit 1;
  if v_id is not null then
    -- refresh the amount in case the tip/total changed since the intent opened
    update public.payment_intents set amount_mdl = v_order.total_mdl, updated_at = now() where id = v_id;
    return v_id;
  end if;
  insert into public.payment_intents (order_id, amount_mdl, provider, status)
  values (p_order_id, v_order.total_mdl, 'mock', 'pending')
  returning id into v_id;
  update public.orders set payment_status = 'pending_capture' where id = p_order_id and payment_status = 'unpaid';
  return v_id;
end; $function$;

-- confirm_catering_quote: 1× `<> auth.uid()` -> `is distinct from auth.uid()`
CREATE OR REPLACE FUNCTION public.confirm_catering_quote(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then
    raise exception 'invalid transition from % — comanda nu mai poate fi confirmată', v_order.status;
  end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  if not found or v_details.quote_status <> 'quoted' then raise exception 'no active quote to confirm'; end if;

  update public.catering_details set quote_status = 'confirmed' where order_id = p_order_id;
  update public.orders
    set status = 'accepted',
        total_mdl = v_details.quoted_total_mdl + coalesce(v_order.tip_mdl, 0)  -- tip on top, not overwritten
    where id = p_order_id;
  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (p_order_id, 'accepted', 'customer', auth.uid());
end;
$function$;

-- confirm_venue_booking: 1× `<> auth.uid()` -> `is distinct from auth.uid()`
CREATE OR REPLACE FUNCTION public.confirm_venue_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_b public.venue_bookings%rowtype;
  v_staff record;
begin
  select * into v_b from public.venue_bookings where id = p_booking_id for update;
  if not found then raise exception 'rezervare inexistentă'; end if;
  if v_b.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_b.status <> 'quoted' then
    raise exception 'doar o rezervare cu ofertă poate fi confirmată (stare: %)', v_b.status;
  end if;

  update public.venue_bookings set status = 'confirmed', updated_at = now() where id = p_booking_id;

  for v_staff in select user_id from public.restaurant_staff where restaurant_id = v_b.venue_id loop
    insert into public.notification_outbox (user_id, title, body, url, tag)
    values (v_staff.user_id, 'Rezervare confirmată',
            format('%s persoane, %s', v_b.party_size,
                   to_char(v_b.starts_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI')),
            '/restaurant/rezervari', 'booking:' || p_booking_id);
  end loop;
end;
$function$;

-- cancel_venue_booking: 1× `<> auth.uid()` -> `is distinct from auth.uid()`
CREATE OR REPLACE FUNCTION public.cancel_venue_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_b public.venue_bookings%rowtype;
  v_staff record;
begin
  select * into v_b from public.venue_bookings where id = p_booking_id for update;
  if not found then raise exception 'rezervare inexistentă'; end if;
  if v_b.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_b.status in ('cancelled', 'declined', 'completed') then
    raise exception 'rezervarea e deja închisă (stare: %)', v_b.status;
  end if;

  update public.venue_bookings set status = 'cancelled', updated_at = now() where id = p_booking_id;

  for v_staff in select user_id from public.restaurant_staff where restaurant_id = v_b.venue_id loop
    insert into public.notification_outbox (user_id, title, body, url, tag)
    values (v_staff.user_id, 'Rezervare anulată de client',
            to_char(v_b.starts_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI'),
            '/restaurant/rezervari', 'booking:' || p_booking_id);
  end loop;
end;
$function$;

-- submit_rating: 1× `<> auth.uid()` -> `is distinct from auth.uid()`
CREATE OR REPLACE FUNCTION public.submit_rating(p_order_id uuid, p_target text, p_stars integer, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_order public.orders%rowtype;
  v_existing public.ratings%rowtype;
  v_delivered_at timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_target not in ('restaurant', 'courier') then raise exception 'invalid rating target'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'stars must be 1-5'; end if;

  -- Lock the order row: serializes concurrent double-submits on the same order
  -- (the unique constraint is the backstop).
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status <> 'delivered' then raise exception 'order not delivered yet'; end if;
  if p_target = 'courier' and v_order.courier_id is null then
    raise exception 'no courier on this order';
  end if;

  -- 30-day rating window, anchored on the real delivered event (audit trail).
  select max(created_at) into v_delivered_at
  from public.delivery_status_events
  where order_id = p_order_id and status = 'delivered';
  if v_delivered_at is not null and v_delivered_at < now() - interval '30 days' then
    raise exception 'rating window closed';
  end if;

  -- Idempotency (WS1 convention): identical retry = silent success;
  -- a *different* re-rating is rejected — ratings are immutable.
  select * into v_existing from public.ratings
  where order_id = p_order_id and target_type = p_target;
  if found then
    if v_existing.stars = p_stars then return; end if;
    raise exception 'already rated';
  end if;

  insert into public.ratings (order_id, customer_id, target_type, restaurant_id, courier_id, stars, comment)
  values (
    p_order_id,
    auth.uid(),
    p_target,
    case when p_target = 'restaurant' then v_order.restaurant_id end,
    case when p_target = 'courier' then v_order.courier_id end,
    p_stars,
    nullif(trim(p_comment), '')
  );

  -- Recompute aggregate from source of truth (no incremental drift; a lost
  -- race between two different orders self-heals on the next rating).
  if p_target = 'restaurant' then
    update public.restaurants r
    set rating_avg = sub.avg_stars, rating_count = sub.cnt
    from (
      select round(avg(stars)::numeric, 2) as avg_stars, count(*) as cnt
      from public.ratings
      where restaurant_id = v_order.restaurant_id and target_type = 'restaurant'
    ) sub
    where r.id = v_order.restaurant_id;
  else
    update public.couriers c
    set rating_avg = sub.avg_stars, rating_count = sub.cnt
    from (
      select round(avg(stars)::numeric, 2) as avg_stars, count(*) as cnt
      from public.ratings
      where courier_id = v_order.courier_id and target_type = 'courier'
    ) sub
    where c.id = v_order.courier_id;
  end if;
end;
$function$;

-- anon has no business with these: each needs a signed-in customer / courier / admin / applicant.
revoke execute on function public.set_order_tip(uuid, numeric) from public, anon;
revoke execute on function public.start_online_payment(uuid) from public, anon;
revoke execute on function public.submit_rating(uuid, text, integer, text) from public, anon;
revoke execute on function public.add_kyc_document(uuid, text, text) from public, anon;
revoke execute on function public.submit_onboarding_application(text, text, text, text, jsonb) from public, anon;
revoke execute on function public.set_cash_policy(numeric, numeric, text, timestamp with time zone, text, numeric, integer) from public, anon;
-- courier_has_capacity(uuid) leaked any courier's busy / cash-capped state to anyone (no policy, view or app uses it as anon).
revoke execute on function public.courier_has_capacity(uuid) from public, anon;
