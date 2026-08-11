-- Audit 2026-08-11 HIGH: the customer was never told their catering quote
-- arrived (or was corrected). submit_catering_quote only UPDATEd
-- catering_details — no delivery_status_events row, so the push-outbox
-- trigger never fired, and no direct outbox insert existed. For an event
-- order the customer may wait DAYS and only finds out by revisiting the
-- page. Recreated from the live body + a direct notification_outbox insert
-- (the drain cron delivers it like every other lifecycle push).

create or replace function public.submit_catering_quote(p_order_id uuid, p_quoted_total_mdl numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
  v_first_quote boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.order_type <> 'catering' then raise exception 'not a catering order'; end if;
  if not has_restaurant_access(v_order.restaurant_id) then raise exception 'not authorized'; end if;
  if v_order.status <> 'pending_restaurant' then raise exception 'comanda nu mai este activă'; end if;

  select * into v_details from public.catering_details where order_id = p_order_id;
  -- allow the FIRST quote (requested) AND corrections before the customer confirms (quoted)
  if not found or v_details.quote_status not in ('requested', 'quoted') then
    raise exception 'oferta nu mai poate fi modificată';
  end if;
  if p_quoted_total_mdl <= 0 then raise exception 'invalid quote amount'; end if;
  if p_quoted_total_mdl < v_order.delivery_fee_mdl then
    raise exception 'quote % is below the delivery fee % — restaurant share would be negative',
      p_quoted_total_mdl, v_order.delivery_fee_mdl;
  end if;

  v_first_quote := v_details.quote_status = 'requested';
  update public.catering_details set quote_status = 'quoted', quoted_total_mdl = p_quoted_total_mdl where order_id = p_order_id;

  -- The customer must hear about it without babysitting the page.
  insert into public.notification_outbox (user_id, title, body, url, tag)
  values (
    v_order.customer_id,
    case when v_first_quote then 'Oferta ta de catering a sosit 🎉' else 'Oferta de catering a fost actualizată ✍️' end,
    'Ofertă: ' || to_char(p_quoted_total_mdl, 'FM999999990') || ' MDL — intră să o confirmi sau să o refuzi.',
    '/catering/' || p_order_id,
    'catering-quote-' || p_order_id
  );
end;
$function$;
