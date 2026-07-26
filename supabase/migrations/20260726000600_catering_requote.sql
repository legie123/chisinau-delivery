-- Operability fix — a partner who mis-types a catering quote (e.g. 1 instead of
-- 1000 MDL) had NO way to correct it: once quote_status='quoted', re-submit was
-- rejected ('quote already submitted') and the partner UI offered no recovery, so
-- a customer could confirm the wrong figure and the restaurant eats the loss.
--
-- Fix: allow RE-QUOTING while the customer hasn't confirmed yet. Line 91 already
-- guards that the order is still 'pending_restaurant' (confirm_catering_quote flips
-- it to 'accepted'), and confirm takes the SAME order row FOR UPDATE, so a confirm
-- and a re-quote serialize — once confirmed, re-quote is blocked. Only line 94
-- changes: accept 'requested' OR 'quoted' (both pre-confirmation states).

create or replace function public.submit_catering_quote(p_order_id uuid, p_quoted_total_mdl numeric)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_details public.catering_details%rowtype;
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

  update public.catering_details set quote_status = 'quoted', quoted_total_mdl = p_quoted_total_mdl where order_id = p_order_id;
end;
$$;
