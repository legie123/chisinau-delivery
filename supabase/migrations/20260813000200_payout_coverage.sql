-- Dezbatere 2026-08-12 BUG confirmat (P5): payout generation had zero
-- coverage surface — a delivered+paid order that no admin's manual date-range
-- run happened to include stayed silently unpaid forever (courier trust).
-- View-only fix (house pattern: security_invoker + baked-in admin gate, like
-- admin_low_ratings): every delivered, PAID order whose courier and/or
-- restaurant has no live (non-reversed) payout_orders row.

create or replace view public.admin_unpaid_delivered_orders
with (security_invoker = on) as
select
  o.id,
  o.order_number,
  o.delivered_at,
  extract(day from now() - o.delivered_at)::int as days_since,
  r.name as restaurant_name,
  c.full_name as courier_name,
  coalesce(o.courier_fee_mdl, o.courier_fee_quoted_mdl, o.delivery_fee_mdl) as courier_due_mdl,
  exists (
    select 1 from public.payout_orders po
    join public.payouts p on p.id = po.payout_id
    where po.order_id = o.id and po.recipient_type = 'courier' and po.reversed_at is null
      and p.recipient_type = 'courier'
  ) as courier_covered,
  exists (
    select 1 from public.payout_orders po
    join public.payouts p on p.id = po.payout_id
    where po.order_id = o.id and po.recipient_type = 'restaurant' and po.reversed_at is null
      and p.recipient_type = 'restaurant'
  ) as restaurant_covered
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
left join public.couriers c on c.id = o.courier_id
where public.has_role('platform_admin')
  and o.status = 'delivered' and o.payment_status = 'paid'
  and (
    not exists (
      select 1 from public.payout_orders po
      join public.payouts p on p.id = po.payout_id
      where po.order_id = o.id and po.recipient_type = 'courier' and po.reversed_at is null
        and p.recipient_type = 'courier'
    )
    or not exists (
      select 1 from public.payout_orders po
      join public.payouts p on p.id = po.payout_id
      where po.order_id = o.id and po.recipient_type = 'restaurant' and po.reversed_at is null
        and p.recipient_type = 'restaurant'
    )
  );

grant select on public.admin_unpaid_delivered_orders to authenticated;
