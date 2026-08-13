-- CRM 2026-08-14: unified partner/account section needs a Clienți tab, but
-- customers had NO admin surface at all — profiles are only readable one-by-one
-- and order aggregates lived nowhere. House pattern: security_invoker view with
-- baked-in admin gate (like admin_unpaid_delivered_orders / admin_low_ratings).
-- Aggregates count only real revenue (delivered) separately from total volume
-- so a serial canceller is visible at a glance.

create or replace view public.admin_customers
with (security_invoker = on) as
select
  p.id,
  p.full_name,
  p.phone,
  p.created_at,
  count(o.id)::int as total_orders,
  count(o.id) filter (where o.status = 'delivered')::int as delivered_orders,
  count(o.id) filter (where o.status = 'cancelled')::int as cancelled_orders,
  coalesce(sum(o.total_mdl) filter (where o.status = 'delivered'), 0)::numeric as spent_mdl,
  max(o.created_at) as last_order_at
from public.profiles p
left join public.orders o on o.customer_id = p.id
where public.has_role('platform_admin')
  and p.role = 'customer'
group by p.id, p.full_name, p.phone, p.created_at;

grant select on public.admin_customers to authenticated;
