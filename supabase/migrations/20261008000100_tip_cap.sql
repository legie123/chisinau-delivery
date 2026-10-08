-- Tip cap. set_order_tip accepted any amount: a cash order could be inflated to any
-- total and the courier told to collect it (collected = total_mdl, tip included).
-- Ceiling = min(food value, pricing_config.tip_max_mdl). Food value is the repo's
-- money definition: standard = subtotal_mdl; catering = total − fee − current tip
-- (the confirmed quote; subtotal is only the tiny menu base there).
-- tip_max_mdl = 500 is PROVISIONAL business config (awaiting founder ratification):
-- versioned on pricing_config like every other number — a change is a new row.
-- place_order takes no tip, so set_order_tip is the only tip writer.
-- Float-cap interaction (sim 84.T4): place_order's 1400 MDL cash cap counts subtotal +
-- fee only, so the largest cash handover is 1400 + 500 = 1900 MDL, above the 1500
-- float cap. That stays as designed: the float cap blocks the NEXT offer
-- (courier_has_capacity) and the accrual trigger forces the courier offline; it
-- never refuses a handover. This migration bounds the overshoot (it was unbounded).

alter table public.pricing_config
  add column if not exists tip_max_mdl numeric(8,2) not null default 500;
alter table public.pricing_config
  drop constraint if exists pricing_config_tip_max_check,
  add constraint pricing_config_tip_max_check check (tip_max_mdl > 0);
comment on column public.pricing_config.tip_max_mdl is
  'PROVIZORIU: plafonul absolut al bacșișului (MDL). set_order_tip aplică min(valoarea mâncării, tip_max_mdl).';

-- set_order_tip: live body + ONE delta (the cap check before the update).
CREATE OR REPLACE FUNCTION public.set_order_tip(p_order_id uuid, p_tip_mdl numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_order public.orders%rowtype; v_new_tip numeric(10,2); v_new_total numeric(10,2); v_cap numeric(10,2); v_max numeric(10,2);
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
  -- Tip cap: min(food value, versioned ceiling).
  v_max := coalesce((select tip_max_mdl from public.current_pricing_config()), 500);
  v_cap := least(v_max,
    case when v_order.order_type = 'catering'
         then greatest(v_order.total_mdl - v_order.delivery_fee_mdl - coalesce(v_order.tip_mdl, 0), 0)
         else coalesce(v_order.subtotal_mdl, 0) end);
  if v_new_tip > v_cap then
    raise exception 'bacșișul poate fi cel mult % MDL (cel mult valoarea comenzii, maxim % MDL)',
      trim_scale(v_cap), trim_scale(v_max);
  end if;
  v_new_total := v_order.total_mdl - coalesce(v_order.tip_mdl, 0) + v_new_tip;
  update public.orders set tip_mdl = v_new_tip, total_mdl = v_new_total where id = p_order_id;
  update public.payment_intents
  set amount_mdl = v_new_total, updated_at = now()
  where order_id = p_order_id and status = 'pending';
end; $function$;

-- set_pricing_config: live body + ONE delta — a commission change carries the current
-- tip ceiling into the new version instead of silently resetting it to the default.
CREATE OR REPLACE FUNCTION public.set_pricing_config(p_courier_pct numeric, p_restaurant_pct numeric, p_effective_from timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_id uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;

  insert into public.pricing_config (effective_from, courier_commission_pct, restaurant_commission_pct, note, created_by, tip_max_mdl)
  values (p_effective_from, p_courier_pct, p_restaurant_pct, p_note, auth.uid(),
          coalesce((select tip_max_mdl from public.pricing_config_at(p_effective_from)), 500))
  returning id into v_id;

  -- Sync the active-rate cache the money functions (admin_generate_payouts, clawback)
  -- already read. platform_settings is now driven only through this RPC.
  update public.platform_settings
    set courier_commission_pct = p_courier_pct, restaurant_commission_pct = p_restaurant_pct;

  -- Announce to couriers — the whole point (no silent change).
  insert into public.notification_outbox (user_id, title, body, url, tag)
  select c.user_id, 'Actualizare tarife',
         format('Comisionul curier devine %s%% de la %s. Bacșișul rămâne 100%% al tău.',
                trim(to_char(p_courier_pct, 'FM990.99')), p_effective_from::date),
         '/earnings', 'pricing'
  from public.couriers c where c.is_active;

  return v_id;
end;
$function$;
