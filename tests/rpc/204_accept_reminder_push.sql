-- Accept reminder (migration 20261012000305_accept_reminder_push). Before the accept SLA
-- auto-cancels an order, the restaurant's staff get ONE push "se anulează în 2 min" —
-- the only escalation that reaches an asleep tablet (the ops alert goes to the admin).
-- Same clock as expire_stale_orders. Rolled back by runner.
do $$
declare
  c_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  c_rest uuid := '11111111-1111-1111-1111-111111111111';
  v_sla int; v_staff int; v_due uuid; v_fresh uuid; v_later uuid; v_cat uuid; v_n int;
begin
  select accept_sla_minutes into v_sla from public.restaurants where id = c_rest;
  select count(*) into v_staff from public.restaurant_staff where restaurant_id = c_rest;
  if v_staff = 0 then raise exception 'P0: Sakura has no staff — sim proves nothing'; end if;

  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('standard', c_cust, c_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 30, 230, now() - make_interval(mins => v_sla - 1))
  returning id into v_due;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', c_cust, c_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 30, 230)
  returning id into v_fresh;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at, requested_for)
  values ('standard', c_cust, c_rest, 'pending_restaurant', 'cash', 'unpaid', 200, 30, 230, now() - interval '3 hours', now() + interval '1 day')
  returning id into v_later;
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, created_at)
  values ('catering', c_cust, c_rest, 'pending_restaurant', 'cash', 'unpaid', 2000, 0, 2000, now() - make_interval(mins => v_sla - 1))
  returning id into v_cat;

  perform public.remind_pending_restaurant_orders();

  -- A1: the order inside the last 2 minutes gets one push per staff member
  select count(*) into v_n from public.notification_outbox where tag = 'acceptreminder:' || v_due;
  if v_n <> v_staff then raise exception 'A1: % reminder rows for the due order, want %', v_n, v_staff; end if;
  -- A2: not for a fresh order, a scheduled one not yet due, or catering (quote flow)
  select count(*) into v_n from public.notification_outbox where tag in ('acceptreminder:' || v_fresh, 'acceptreminder:' || v_later, 'acceptreminder:' || v_cat);
  if v_n <> 0 then raise exception 'A2: % reminders for orders outside the window', v_n; end if;
  -- A3: running again (the cron fires every minute) does not duplicate
  perform public.remind_pending_restaurant_orders();
  select count(*) into v_n from public.notification_outbox where tag = 'acceptreminder:' || v_due;
  if v_n <> v_staff then raise exception 'A3: duplicated reminder (% rows)', v_n; end if;
  -- A4: an accepted order is never reminded
  update public.orders set status = 'accepted' where id = v_fresh;
  update public.orders set created_at = now() - make_interval(mins => v_sla - 1) where id = v_fresh;
  perform public.remind_pending_restaurant_orders();
  select count(*) into v_n from public.notification_outbox where tag = 'acceptreminder:' || v_fresh;
  if v_n <> 0 then raise exception 'A4: accepted order was reminded'; end if;
  -- A5: the message names the order and the restaurant tablet URL
  select count(*) into v_n from public.notification_outbox
   where tag = 'acceptreminder:' || v_due and url = '/restaurant/orders'
     and body like '%' || (select order_number from public.orders where id = v_due) || '%';
  if v_n <> v_staff then raise exception 'A5: reminder text/url wrong'; end if;
  -- A6: only the cron (owner) runs it — no client role can, and it is scheduled
  if has_function_privilege('authenticated', 'public.remind_pending_restaurant_orders()', 'execute')
     or has_function_privilege('anon', 'public.remind_pending_restaurant_orders()', 'execute') then
    raise exception 'A6: callable by a client role'; end if;
  select count(*) into v_n from cron.job where jobname = 'remind-pending-orders';
  if v_n <> 1 then raise exception 'A6b: cron job missing'; end if;

  raise notice 'accept reminder A1-A6 OK';
end $$;
