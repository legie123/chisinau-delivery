-- CRM Clienți (admin_customers) — gate + corectitudine agregate, 2026-08-14.
-- View-ul e sursa tabului Clienți din /platform/crm: per client, volum total,
-- split delivered/cancelled și revenue DOAR din delivered. Aserțiunile sunt
-- relative (recalculate din orders în același snapshot), deci nu depind de
-- câte comenzi are deja clientul seed-uit în DB-ul local.
-- S1: admin vede rândul clientului, iar agregatele = recalculul manual.
-- S2: spent_mdl NU crește la o comandă cancelled nouă (doar total_orders).
-- S3: non-admin (clientul însuși) vede zero rânduri — gate-ul has_role ține.

do $$
declare
  v_cust uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin uuid := 'a0000000-0000-0000-0000-000000000004';
  v_rest uuid;
  v_total int; v_delivered int; v_cancelled int; v_spent numeric;
  r record;
  v_rows int;
begin
  select id into v_rest from public.restaurants where is_active order by name limit 1;

  -- Fixture: o comandă delivered (+225 revenue) și una cancelled (0 revenue).
  insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status,
                             subtotal_mdl, delivery_fee_mdl, total_mdl)
  values ('standard', v_cust, v_rest, 'delivered', 'cash', 'paid', 200, 25, 225),
         ('standard', v_cust, v_rest, 'cancelled', 'cash', 'unpaid', 100, 25, 125);

  -- Recalcul manual din orders — etalonul pentru view.
  select count(*)::int,
         count(*) filter (where status = 'delivered')::int,
         count(*) filter (where status = 'cancelled')::int,
         coalesce(sum(total_mdl) filter (where status = 'delivered'), 0)
    into v_total, v_delivered, v_cancelled, v_spent
  from public.orders where customer_id = v_cust;

  -- ===== S1 + S2: ca admin, rândul există și agregatele bat cu etalonul =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select * into r from public.admin_customers where id = v_cust;
  if r.id is null then
    raise exception 'FAIL S1: admin nu vede clientul seed-uit în admin_customers';
  end if;
  if r.total_orders <> v_total or r.delivered_orders <> v_delivered or r.cancelled_orders <> v_cancelled then
    raise exception 'FAIL S1: split gresit (view %/%/% vs etalon %/%/%)',
      r.total_orders, r.delivered_orders, r.cancelled_orders, v_total, v_delivered, v_cancelled;
  end if;
  raise notice 'PASS S1: admin vede clientul cu splitul corect (%/%/%)', v_total, v_delivered, v_cancelled;

  if r.spent_mdl <> v_spent then
    raise exception 'FAIL S2: spent_mdl % nu bate cu etalonul delivered-only % (comanda cancelled a intrat în revenue?)',
      r.spent_mdl, v_spent;
  end if;
  raise notice 'PASS S2: spent_mdl numără doar revenue delivered (%)', v_spent;

  -- ===== S3: clientul însuși nu vede nimic prin view =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  select count(*)::int into v_rows from public.admin_customers;
  if v_rows <> 0 then
    raise exception 'FAIL S3: non-admin vede % rânduri în admin_customers', v_rows;
  end if;
  raise notice 'PASS S3: gate-ul has_role ascunde CRM-ul de non-admini';

  perform set_config('request.jwt.claims', null, true);
end $$;
