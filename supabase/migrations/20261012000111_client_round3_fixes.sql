-- CLIENT red-team round 3 (7 defects).
-- 1 HIGH  delete_my_account set auth.users.banned_until = 'infinity'; GoTrue cannot scan it into a
--         time.Time -> 500 on the admin user list (Studio) and on that user. Now a finite date, and the
--         rows already written are repaired.
-- 2 MED   delete_my_account left personal data: ratings comments, the customer's own complaint text,
--         catering/venue contacts and notes, pending onboarding applications, sent notifications,
--         one-time tokens, recovery token, auth audit rows. All scrubbed now (scrub_deleted_customer,
--         internal); a future requested/quoted/confirmed venue booking blocks the deletion like an
--         order in flight. Accounts deleted before this migration are re-scrubbed here.
-- 3 MED   the customer read policy on order_complaints exposed ops' internal notes/resolutions: dropped;
--         the app reads only the status through my_order_complaint_status(order).
-- 4 MED   ops webhook injection: the alert no longer carries the customer's text; scan_ops_alerts
--         neutralizes < > @ and disables Discord mentions.
-- 5 LOW+  a JWT issued before the deletion kept working (place_order, address/profile writes): blocked.
-- 6 LOW   customer_report_problem: a never-accepted cancelled/rejected order is refused; max 3 per order.
-- 7 LOW   request fingerprint: lines sorted on their NORMALIZED options.
-- Live bodies (place_order 108, customer_report_problem 109, scan_ops_alerts 407) + these deltas;
-- delete_my_account is replaced (created today, 107).
-- Rollback: re-apply 107/108/109/110/407 bodies and policies; drop the new functions and triggers.

drop policy if exists order_complaints_customer_read on public.order_complaints;

create or replace function public.scrub_deleted_customer(p_uid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
begin
  perform public.erase_customer_pii(p_uid);
  update public.addresses set contact_phone = null, street_address = 'Adresă ștearsă', label = null, notes = null, intercom_code = null
   where customer_id = p_uid;
  update public.profiles set full_name = 'Utilizator șters', phone = null where id = p_uid;
  update public.orders set notes = null where customer_id = p_uid and notes is not null;
  update public.order_items oi set notes = null
    from public.orders o where o.id = oi.order_id and o.customer_id = p_uid and oi.notes is not null;
  update public.ratings set comment = null where customer_id = p_uid and comment is not null;
  update public.order_complaints set note = '[șters]' where created_by = p_uid;
  update public.catering_details cd set contact_person = 'Șters', contact_phone = '', event_address_text = 'Adresă ștearsă'
    from public.orders o where o.id = cd.order_id and o.customer_id = p_uid;
  update public.venue_bookings set contact_person = 'Șters', contact_phone = '', notes = null where customer_id = p_uid;
  update public.onboarding_applications set full_name = 'Solicitant șters', phone = '', email = null, details = '{}'::jsonb,
         status = case when status = 'pending' then 'rejected' else status end,
         review_note = case when status = 'pending' then 'Cont șters de utilizator' else review_note end
   where user_id = p_uid;
  delete from public.device_push_tokens where user_id = p_uid;
  delete from public.push_subscriptions where user_id = p_uid;
  delete from public.favorites where customer_id = p_uid;
  delete from public.notification_outbox where user_id = p_uid;
  delete from auth.sessions where user_id = p_uid;
  delete from auth.identities where user_id = p_uid;
  delete from auth.one_time_tokens where user_id = p_uid;
  delete from auth.audit_log_entries where payload ->> 'actor_id' = p_uid::text;
  update auth.users
     set email = 'sters-' || p_uid::text || '@deleted.invalid',
         phone = null, encrypted_password = '', raw_user_meta_data = '{}'::jsonb,
         confirmation_token = '', recovery_token = '', email_change = '', email_change_token_new = '',
         email_change_token_current = '', phone_change = '', phone_change_token = '', reauthentication_token = '',
         banned_until = '2999-12-31 00:00:00+00',      -- finite: GoTrue cannot read 'infinity'
         deleted_at = coalesce(deleted_at, now())
   where id = p_uid;
end; $function$;

revoke all on function public.scrub_deleted_customer(uuid) from public, anon, authenticated;

create or replace function public.delete_my_account()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.profiles where id = v_uid and role <> 'customer') then
    raise exception 'Contul de curier sau de partener se închide prin echipa noastră — scrie-ne.';
  end if;
  if exists (select 1 from public.orders where customer_id = v_uid
             and status not in ('delivered', 'cancelled', 'rejected')) then
    raise exception 'Ai o comandă în curs — contul se poate șterge după ce se încheie.';
  end if;
  if exists (select 1 from public.venue_bookings where customer_id = v_uid
             and status in ('requested', 'quoted', 'confirmed') and ends_at > now()) then
    raise exception 'Ai o rezervare în curs — anuleaz-o sau așteaptă să treacă, apoi șterge contul.';
  end if;
  perform public.scrub_deleted_customer(v_uid);
end; $function$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 5: a deleted account (JWT still valid until expiry) cannot write addresses or its profile.
create or replace function public.guard_deleted_account_write()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
begin
  if auth.uid() is not null
     and exists (select 1 from auth.users u where u.id = auth.uid() and u.deleted_at is not null) then
    raise exception 'Contul a fost șters.';
  end if;
  return new;
end; $function$;
revoke all on function public.guard_deleted_account_write() from public, anon, authenticated;
drop trigger if exists addresses_guard_deleted_account on public.addresses;
create trigger addresses_guard_deleted_account before insert or update on public.addresses
  for each row execute function public.guard_deleted_account_write();
drop trigger if exists profiles_guard_deleted_account on public.profiles;
create trigger profiles_guard_deleted_account before update on public.profiles
  for each row execute function public.guard_deleted_account_write();

-- 3: the customer sees only the status of the latest complaint on their own order.
create or replace function public.my_order_complaint_status(p_order_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select oc.status from public.order_complaints oc
  join public.orders o on o.id = oc.order_id
  where oc.order_id = p_order_id and o.customer_id = auth.uid()
  order by oc.created_at desc limit 1;
$function$;
revoke all on function public.my_order_complaint_status(uuid) from public, anon;
grant execute on function public.my_order_complaint_status(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.place_order(p_restaurant_id uuid, p_order_type text, p_payment_method text, p_items jsonb, p_delivery_address_id uuid DEFAULT NULL::uuid, p_requested_for timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_catering jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_fingerprint text;
  v_restaurant public.restaurants%rowtype;
  v_order_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_item jsonb;
  v_menu_item public.menu_items%rowtype;
  v_qty int;
  v_unit numeric(10, 2);
  v_line_total numeric(10, 2);
  v_min numeric(10, 2);
  v_opt_ids uuid[];
  v_opt_delta numeric(10, 2);
  v_opt_snapshot jsonb;
  v_grp record;
  v_selected_in_grp int;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  -- A JWT issued before delete_my_account stays valid up to its expiry: a deleted account orders nothing.
  if exists (select 1 from auth.users u where u.id = auth.uid() and u.deleted_at is not null) then
    raise exception 'Contul a fost șters.';
  end if;

  -- Canonical request (red-team round 2): a key hit must be the SAME request, not just the same total.
  -- Items are normalized (sorted, option ids sorted, notes trimmed), so a re-ordered payload matches.
  v_fingerprint := md5(jsonb_build_object(
    'r', p_restaurant_id, 't', p_order_type, 'pm', p_payment_method, 'a', p_delivery_address_id,
    'rf', p_requested_for, 'n', nullif(btrim(coalesce(p_notes, '')), ''), 'c', p_catering,
    'i', (select jsonb_agg(l order by l ->> 'm', (l ->> 'q')::int, (l -> 'o')::text, coalesce(l ->> 'n', ''))
          from (select jsonb_build_object(
                   'm', e ->> 'menu_item_id', 'q', (e ->> 'quantity')::int,
                   'o', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(e -> 'option_ids', '[]'::jsonb)) x),
                   'n', nullif(btrim(coalesce(e ->> 'notes', '')), '')) as l
                from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e) lines)
  )::text);

  if p_idempotency_key is not null then
    select id into v_order_id from public.orders
    where customer_id = auth.uid() and idempotency_key = p_idempotency_key;
    if v_order_id is not null then
      if exists (select 1 from public.orders o where o.id = v_order_id
                 and o.request_fingerprint is not null and o.request_fingerprint <> v_fingerprint) then
        raise exception 'comanda a fost deja plasată cu alte detalii (%) — o găsești la Comenzi',
          (select order_number from public.orders where id = v_order_id);
      end if;
      -- A retry must be the SAME order the customer saw: a lost response followed by a changed
      -- cart under the same key returned the old order (shown 818, charged 2378). Refuse instead.
      if p_expected_total is not null and exists (
        select 1 from public.orders o
        where o.id = v_order_id and o.order_type = 'standard'
          and abs((o.subtotal_mdl + o.delivery_fee_mdl) - p_expected_total) > 0.005
      ) then
        raise exception 'comanda a fost deja plasată cu alt total (%) — o găsești la Comenzi',
          (select order_number from public.orders where id = v_order_id);
      end if;
      return v_order_id;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  -- Scheduled window (20261008000200): 2 min skew grace; 7 days standard, 60 catering.
  if p_requested_for is not null then
    if p_requested_for < now() - interval '2 minutes' then
      raise exception 'ora programată nu poate fi în trecut';
    end if;
    if p_order_type = 'catering' then
      if p_requested_for > now() + interval '60 days' then
        raise exception 'evenimentul se poate programa cu cel mult 60 de zile înainte';
      end if;
    elsif p_requested_for > now() + interval '7 days' then
      raise exception 'livrarea se poate programa cu cel mult 7 zile înainte';
    end if;
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then raise exception 'restaurant not found'; end if;
  if not v_restaurant.is_active or not v_restaurant.accepting_orders then
    raise exception 'restaurant is not currently accepting orders';
  end if;
  if p_order_type = 'catering' and (not v_restaurant.accepts_catering or p_catering is null) then
    raise exception 'invalid catering request';
  end if;

  if p_order_type = 'standard' then
    if p_delivery_address_id is null then raise exception 'adresa de livrare este obligatorie'; end if;
    if not exists (select 1 from public.addresses a where a.id = p_delivery_address_id and a.customer_id = auth.uid()) then
      raise exception 'adresa de livrare nu îți aparține';
    end if;
    -- C1: a pin inside the restaurant's delivery radius (no pin = assumed 6 km tariff, no drop-off point).
    if exists (select 1 from public.addresses a where a.id = p_delivery_address_id and (a.lat is null or a.lng is null)) then
      raise exception 'fixează pinul adresei pe hartă — curierul trebuie să știe exact unde livrează';
    end if;
    if not exists (
      select 1 from public.addresses a
      where a.id = p_delivery_address_id and v_restaurant.geo is not null
        and extensions.st_dwithin(v_restaurant.geo,
              extensions.st_setsrid(extensions.st_makepoint(a.lng::float8, a.lat::float8), 4326)::extensions.geography,
              v_restaurant.delivery_radius_km * 1000)
    ) then
      raise exception 'adresa este în afara zonei de livrare a restaurantului (% km)', trim_scale(v_restaurant.delivery_radius_km);
    end if;
    if not public.restaurant_open_at(p_restaurant_id, coalesce(p_requested_for, now())) then
      raise exception 'restaurantul este închis la ora selectată';
    end if;
  end if;

  insert into public.orders (order_type, customer_id, restaurant_id, delivery_address_id, payment_method, delivery_fee_mdl, requested_for, notes, idempotency_key, request_fingerprint)
  values (p_order_type, auth.uid(), p_restaurant_id, p_delivery_address_id, p_payment_method, v_restaurant.delivery_fee_mdl, p_requested_for, p_notes, p_idempotency_key, v_fingerprint)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu_item
    from public.menu_items
    where id = (v_item ->> 'menu_item_id')::uuid and restaurant_id = p_restaurant_id and is_available = true;
    if not found then raise exception 'menu item unavailable'; end if;

    if v_menu_item.is_catering_only and p_order_type <> 'catering' then
      raise exception 'produsul % este disponibil doar pentru catering', v_menu_item.name;
    end if;

    -- "Epuizat" from the kitchen tablet (20261012000303): sold out for the moment the food is for.
    if v_menu_item.sold_out_until is not null and v_menu_item.sold_out_until > coalesce(p_requested_for, now()) then
      raise exception 'produsul „%” este epuizat momentan — scoate-l din coș', v_menu_item.name;
    end if;

    v_qty := (v_item ->> 'quantity')::int;
    if v_qty <= 0 or (v_menu_item.catering_min_qty is not null and v_qty < v_menu_item.catering_min_qty) then
      raise exception 'invalid quantity for %', v_menu_item.name;
    end if;

    -- ---- options: validate, recompute delta, snapshot ----
    v_opt_ids := coalesce((select array_agg((e)::uuid) from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) e), '{}');
    v_opt_delta := 0;
    v_opt_snapshot := '[]'::jsonb;

    -- every chosen option must be an available option in a group of THIS item
    if array_length(v_opt_ids, 1) is not null then
      if exists (
        select 1 from unnest(v_opt_ids) oid
        where not exists (
          select 1 from public.menu_options o
          join public.menu_option_groups g on g.id = o.group_id
          where o.id = oid and o.is_available and g.menu_item_id = v_menu_item.id
        )
      ) then
        raise exception 'opțiune invalidă pentru %', v_menu_item.name;
      end if;
    end if;

    -- required/min/max per group
    for v_grp in select * from public.menu_option_groups where menu_item_id = v_menu_item.id loop
      select count(*) into v_selected_in_grp
      from public.menu_options o where o.group_id = v_grp.id and o.id = any(v_opt_ids);
      if v_grp.is_required and v_selected_in_grp < greatest(v_grp.min_select, 1) then
        raise exception 'alege o opțiune la "%" pentru %', v_grp.name, v_menu_item.name;
      end if;
      if v_selected_in_grp < v_grp.min_select then
        raise exception 'prea puține opțiuni la "%"', v_grp.name;
      end if;
      if v_selected_in_grp > v_grp.max_select then
        raise exception 'prea multe opțiuni la "%"', v_grp.name;
      end if;
    end loop;

    -- delta + snapshot from the DB (authoritative prices, not the client)
    select coalesce(sum(o.price_delta_mdl), 0),
           coalesce(jsonb_agg(jsonb_build_object('group', g.name, 'name', o.name, 'price_delta_mdl', o.price_delta_mdl) order by g.sort_order, o.sort_order), '[]'::jsonb)
    into v_opt_delta, v_opt_snapshot
    from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
    where o.id = any(v_opt_ids);

    v_unit := v_menu_item.price_mdl + v_opt_delta;
    v_line_total := v_unit * v_qty;
    -- C2: a note per dish ("fără wasabi") for the kitchen ticket; trimmed, blank -> NULL, max 140.
    if length(btrim(coalesce(v_item ->> 'notes', ''))) > 140 then
      raise exception 'nota pentru „%” poate avea cel mult 140 de caractere', v_menu_item.name;
    end if;
    insert into public.order_items (order_id, menu_item_id, item_name_snapshot, unit_price_mdl, quantity, line_total_mdl, selected_options, notes)
    values (v_order_id, v_menu_item.id, v_menu_item.name, v_unit, v_qty, v_line_total, v_opt_snapshot,
            nullif(btrim(coalesce(v_item ->> 'notes', '')), ''));
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_min := case when p_order_type = 'catering' then v_restaurant.catering_min_amount_mdl else v_restaurant.min_order_amount_mdl end;
  if v_min is not null and v_subtotal < v_min then
    raise exception 'subtotal % MDL below minimum % MDL', v_subtotal, v_min;
  end if;

  -- Armata 2026-08-13: plafon COD. O comandă standard CASH peste plafonul de
  -- float al oricărui curier nu poate fi dispecerizată sub gate-ul cash-aware
  -- (ar muri în anularea de 6h) — respinge la checkout, cu alternativa card.
  if p_order_type = 'standard' and p_payment_method = 'cash'
     and (v_subtotal + v_restaurant.delivery_fee_mdl) > 1400 then
    raise exception 'comenzile peste 1400 MDL se achită cu cardul la livrare';
  end if;

  update public.orders set subtotal_mdl = v_subtotal, total_mdl = v_subtotal + delivery_fee_mdl where id = v_order_id;
  -- The customer pays what was shown: a delivery fee or menu price that changed between the
  -- checkout's read and this call refuses the order (the raise rolls the insert back).
  if p_expected_total is not null and p_order_type = 'standard'
     and abs((v_subtotal + v_restaurant.delivery_fee_mdl) - p_expected_total) > 0.005 then
    raise exception 'prețul s-a schimbat: totalul este acum % MDL', trim_scale(v_subtotal + v_restaurant.delivery_fee_mdl);
  end if;

  if p_order_type = 'catering' then
    insert into public.catering_details (order_id, event_date, event_time, guest_count, event_address_text, contact_person, contact_phone)
    values (v_order_id, (p_catering ->> 'event_date')::date, nullif(p_catering ->> 'event_time', '')::time,
            (p_catering ->> 'guest_count')::int, p_catering ->> 'event_address_text',
            p_catering ->> 'contact_person', p_catering ->> 'contact_phone');
  end if;

  insert into public.delivery_status_events (order_id, status, actor_role, actor_id)
  values (v_order_id, 'pending_restaurant', 'customer', auth.uid());
  return v_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.customer_report_problem(p_order_id uuid, p_kind text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_order public.orders%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  if v_order.status = 'pending_restaurant' then
    raise exception 'Comanda nu e încă acceptată — o poți anula direct din ecranul comenzii.';
  end if;
  if exists (select 1 from public.order_complaints where order_id = p_order_id and status = 'open') then
    raise exception 'Ai deja o problemă raportată pe această comandă — echipa te contactează.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Descrie pe scurt ce s-a întâmplat.'; end if;
  -- "after acceptance": a cancelled/rejected order that was never accepted has nothing to report.
  if v_order.status in ('cancelled', 'rejected')
     and not exists (select 1 from public.delivery_status_events ev where ev.order_id = p_order_id and ev.status = 'accepted') then
    raise exception 'Comanda n-a fost acceptată de restaurant — scrie-ne dacă ai nevoie de ajutor.';
  end if;
  if (select count(*) from public.order_complaints where order_id = p_order_id) >= 3 then
    raise exception 'Ai raportat deja de mai multe ori pe această comandă — scrie-ne direct.';
  end if;

  insert into public.order_complaints (order_id, kind, note, created_by)
  values (p_order_id, p_kind, btrim(p_note), auth.uid())
  returning id into v_id;

  insert into public.ops_alerts (kind, ref_id, message)
  values ('customer_complaint', v_id,
          -- No customer text in the alert: it is posted to the ops chat webhook (no injection channel).
          format('Clientul a raportat o problemă (%s) la comanda %s — vezi panoul.', p_kind, v_order.order_number))
  on conflict (kind, ref_id) do nothing;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.scan_ops_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare v_new int := 0; v_n int; v_url text := nullif(current_setting('app.ops_alert_webhook_url', true), ''); a record;
begin
  insert into public.ops_alerts (kind, ref_id, message)
  select 'restaurant_not_accepting', o.id,
         format('Comanda %s așteaptă acceptarea de %s min la %s — sună restaurantul.',
                o.order_number, floor(extract(epoch from now() - o.created_at) / 60)::int, r.name)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.status = 'pending_restaurant' and o.order_type = 'standard'
    and greatest(o.created_at, coalesce(o.requested_for - interval '60 minutes', o.created_at))
        < now() - make_interval(mins => (select ps.restaurant_accept_alert_minutes from public.platform_settings ps where ps.id))
  on conflict (kind, ref_id) do nothing;
  get diagnostics v_n = row_count; v_new := v_new + v_n;

  insert into public.ops_alerts (kind, ref_id, message)
  select 'dispatch_error', e.order_id,
         format('Dispecerizarea comenzii %s eșuează: %s', o.order_number, e.message)
  from public.dispatch_errors e join public.orders o on o.id = e.order_id
  where o.status = 'ready_for_pickup'
  on conflict (kind, ref_id) do nothing;
  get diagnostics v_n = row_count; v_new := v_new + v_n;

  insert into public.ops_alerts (kind, ref_id, message)
  select 'push_stuck', n.id, format('Notificarea „%s” nu a plecat de %s min (încercări: %s).',
                                    n.title, floor(extract(epoch from now() - n.created_at) / 60)::int, n.attempts)
  from public.notification_outbox n
  where n.sent_at is null and n.created_at < now() - interval '5 minutes'
  on conflict (kind, ref_id) do nothing;
  get diagnostics v_n = row_count; v_new := v_new + v_n;

  if v_url is not null then
    for a in select id, message from public.ops_alerts where notified_at is null and acked_at is null order by created_at limit 50 loop
      perform net.http_post(url := v_url,
                            headers := jsonb_build_object('Content-Type', 'application/json'),
                            -- Neutralized: no Slack <!channel>/<url|label>, no Discord @everyone; mentions disabled.
                            body := jsonb_build_object(
                              'text', translate(a.message, '<>@', '‹›＠'),
                              'content', translate(a.message, '<>@', '‹›＠'),
                              'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)));
      update public.ops_alerts set notified_at = now() where id = a.id;
    end loop;
  end if;
  return v_new;
end; $function$;

-- 1 + 2 data repair: accounts already deleted (incl. the 'infinity' bans) are re-scrubbed.
do $$
declare v uuid;
begin
  for v in select id from auth.users where email like 'sters-%@deleted.invalid' or banned_until = 'infinity' loop
    perform public.scrub_deleted_customer(v);
  end loop;
end $$;
