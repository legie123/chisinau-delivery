-- ============================================================================
-- Customer status pushes → durable outbox (audit MEDIUM #4)
-- Restaurant + courier pushes already flow through notification_outbox (retry via
-- the drain cron). Customer status pushes were fire-and-forget app code
-- (notifyOrderCustomer) that swallowed errors and died with the request thread.
-- Move them onto the same reliable outbox via a trigger on the canonical
-- status-change record (delivery_status_events), so EVERY path that advances an
-- order notifies the customer durably, uniformly.
-- ============================================================================
create or replace function public.enqueue_customer_status_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.orders%rowtype; v_title text; v_body text;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then return new; end if;

  -- Only the customer-meaningful milestones (skip pending_restaurant = the
  -- new-order event that targets the restaurant, and internal ready/assigned).
  v_title := case new.status
    when 'accepted'         then 'Comanda a fost acceptată 👨‍🍳'
    when 'ready_for_pickup' then 'Comanda e gata 🥡'
    when 'picked_up'  then 'Curierul a ridicat comanda 🛵'
    when 'en_route'   then 'Comanda ta e pe drum 🚀'
    when 'delivered'  then 'Comandă livrată 🎉'
    when 'rejected'   then 'Comanda a fost refuzată'
    when 'cancelled'  then 'Comanda a fost anulată'
    else null
  end;
  if v_title is null then return new; end if;

  v_body := v_order.order_number || coalesce(' — ' || nullif(new.note, ''), '');

  insert into public.notification_outbox (user_id, title, body, url, tag)
  values (v_order.customer_id, v_title, v_body, '/orders/' || v_order.id::text, 'order-' || v_order.id::text);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_customer_status_push on public.delivery_status_events;
create trigger trg_enqueue_customer_status_push
  after insert on public.delivery_status_events
  for each row execute function public.enqueue_customer_status_push();
