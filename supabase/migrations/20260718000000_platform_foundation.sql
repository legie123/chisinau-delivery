-- Platform foundation for the next build wave: Notifications (Web Push),
-- Payments/payouts, Onboarding/KYC, Customer UX (tipping + favorites).
-- Additive, RLS-guarded, RPC-only writes on money/status. New tables inherit the
-- grants-parity default privileges (grant all to anon/authenticated, RLS gates rows).

-- ============================================================================
-- NOTIFICATIONS — Web Push subscriptions (one row per browser/device endpoint)
-- ============================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subs_self" on public.push_subscriptions;
create policy "push_subs_self" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Admin/definer send-path reads all via service role (bypasses RLS).

-- ============================================================================
-- CUSTOMER UX — tipping + favorites
-- ============================================================================
alter table public.orders add column if not exists tip_mdl numeric(10, 2) not null default 0 check (tip_mdl >= 0);

create table if not exists public.favorites (
  customer_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, restaurant_id)
);
alter table public.favorites enable row level security;
drop policy if exists "favorites_self" on public.favorites;
create policy "favorites_self" on public.favorites
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- ============================================================================
-- PAYMENTS — online payment intents (gateway-agnostic) + tip settle
-- ============================================================================
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_mdl numeric(10, 2) not null,
  provider text not null default 'mock',      -- 'mock' | 'maib' | 'paynet' later
  provider_ref text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_intents_order_idx on public.payment_intents(order_id);
alter table public.payment_intents enable row level security;
drop policy if exists "payment_intents_customer_read" on public.payment_intents;
create policy "payment_intents_customer_read" on public.payment_intents
  for select using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
drop policy if exists "payment_intents_admin_read" on public.payment_intents;
create policy "payment_intents_admin_read" on public.payment_intents
  for select using (has_role('platform_admin'));
-- No client write policy — created + settled only by the RPCs below.

-- start_online_payment: the customer opens an intent for their unpaid order.
create or replace function public.start_online_payment(p_order_id uuid)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_order public.orders%rowtype; v_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_order.payment_status = 'paid' then raise exception 'already paid'; end if;
  -- reuse a pending intent if one exists
  select id into v_id from public.payment_intents where order_id = p_order_id and status = 'pending' limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.payment_intents (order_id, amount_mdl, provider, status)
  values (p_order_id, v_order.total_mdl + coalesce(v_order.tip_mdl, 0), 'mock', 'pending')
  returning id into v_id;
  update public.orders set payment_status = 'pending_capture' where id = p_order_id and payment_status = 'unpaid';
  return v_id;
end; $$;
grant execute on function public.start_online_payment(uuid) to authenticated;

-- confirm_online_payment: MOCK settle (stands in for the gateway webhook). The
-- real maib/PayNet callback will call the same body server-side with the provider ref.
create or replace function public.confirm_online_payment(p_intent_id uuid, p_success boolean, p_provider_ref text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_intent public.payment_intents%rowtype; v_order public.orders%rowtype;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception 'intent not found'; end if;
  select * into v_order from public.orders where id = v_intent.order_id for update;
  -- authz: the order's customer (mock) or admin (real webhook runs as service role → bypasses RLS/this check)
  if v_order.customer_id <> auth.uid() and not has_role('platform_admin') then raise exception 'not authorized'; end if;
  if v_intent.status <> 'pending' then return; end if; -- idempotent

  if p_success then
    update public.payment_intents set status = 'succeeded', provider_ref = p_provider_ref, updated_at = now() where id = p_intent_id;
    update public.orders set payment_status = 'paid' where id = v_intent.order_id;
    insert into public.delivery_status_events (order_id, status, actor_role, actor_id, note)
    values (v_intent.order_id, v_order.status, 'customer', auth.uid(), 'online payment succeeded');
  else
    update public.payment_intents set status = 'failed', updated_at = now() where id = p_intent_id;
    update public.orders set payment_status = 'unpaid' where id = v_intent.order_id and payment_status = 'pending_capture';
  end if;
end; $$;
grant execute on function public.confirm_online_payment(uuid, boolean, text) to authenticated;

-- ============================================================================
-- PAYOUTS — courier/restaurant earnings settlement + commission
-- ============================================================================
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  courier_commission_pct numeric(5, 2) not null default 15.00,
  restaurant_commission_pct numeric(5, 2) not null default 20.00,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings_admin" on public.platform_settings;
create policy "platform_settings_admin" on public.platform_settings
  for select using (has_role('platform_admin'));

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('courier', 'restaurant')),
  recipient_id uuid not null,
  period_start date not null,
  period_end date not null,
  orders_count int not null default 0,
  gross_mdl numeric(10, 2) not null default 0,
  commission_mdl numeric(10, 2) not null default 0,
  net_mdl numeric(10, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_type, recipient_id, period_start, period_end)
);
alter table public.payouts enable row level security;
drop policy if exists "payouts_courier_read" on public.payouts;
create policy "payouts_courier_read" on public.payouts
  for select using (recipient_type = 'courier' and recipient_id in (select id from public.couriers where user_id = auth.uid()));
drop policy if exists "payouts_restaurant_read" on public.payouts;
create policy "payouts_restaurant_read" on public.payouts
  for select using (recipient_type = 'restaurant' and has_restaurant_access(recipient_id));
drop policy if exists "payouts_admin_read" on public.payouts;
create policy "payouts_admin_read" on public.payouts
  for select using (has_role('platform_admin'));

-- admin_generate_payouts: build pending payout rows for delivered orders in a period.
-- Restaurant net = subtotal - restaurant_commission%. Courier net = delivery_fee + tips
-- - courier_commission% of the delivery fee. Idempotent via the unique key.
create or replace function public.admin_generate_payouts(p_start date, p_end date)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_c record; v_settings public.platform_settings%rowtype; v_n int := 0;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_settings from public.platform_settings where id;

  -- Restaurants
  for v_c in
    select o.restaurant_id as rid,
           count(*) as cnt,
           sum(o.subtotal_mdl) as gross
    from public.orders o
    where o.status = 'delivered' and o.order_type = 'standard'
      and o.created_at::date between p_start and p_end
    group by o.restaurant_id
  loop
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('restaurant', v_c.rid, p_start, p_end, v_c.cnt, v_c.gross,
            round(v_c.gross * v_settings.restaurant_commission_pct / 100, 2),
            round(v_c.gross * (1 - v_settings.restaurant_commission_pct / 100), 2))
    on conflict (recipient_type, recipient_id, period_start, period_end) do update
      set orders_count = excluded.orders_count, gross_mdl = excluded.gross_mdl,
          commission_mdl = excluded.commission_mdl, net_mdl = excluded.net_mdl
      where public.payouts.status = 'pending';
    v_n := v_n + 1;
  end loop;

  -- Couriers
  for v_c in
    select o.courier_id as cid,
           count(*) as cnt,
           sum(o.delivery_fee_mdl + coalesce(o.tip_mdl, 0)) as gross,
           sum(o.delivery_fee_mdl) as fees
    from public.orders o
    where o.status = 'delivered' and o.courier_id is not null
      and o.created_at::date between p_start and p_end
    group by o.courier_id
  loop
    insert into public.payouts (recipient_type, recipient_id, period_start, period_end, orders_count, gross_mdl, commission_mdl, net_mdl)
    values ('courier', v_c.cid, p_start, p_end, v_c.cnt, v_c.gross,
            round(v_c.fees * v_settings.courier_commission_pct / 100, 2),
            round(v_c.gross - v_c.fees * v_settings.courier_commission_pct / 100, 2))
    on conflict (recipient_type, recipient_id, period_start, period_end) do update
      set orders_count = excluded.orders_count, gross_mdl = excluded.gross_mdl,
          commission_mdl = excluded.commission_mdl, net_mdl = excluded.net_mdl
      where public.payouts.status = 'pending';
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke execute on function public.admin_generate_payouts(date, date) from public, anon, authenticated;
grant execute on function public.admin_generate_payouts(date, date) to authenticated; -- RPC self-checks has_role

create or replace function public.admin_mark_payout_paid(p_payout_id uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  update public.payouts set status = 'paid', paid_at = now() where id = p_payout_id and status = 'pending';
end; $$;
grant execute on function public.admin_mark_payout_paid(uuid) to authenticated;

-- ============================================================================
-- ONBOARDING / KYC — self-apply to become courier/restaurant, admin reviews
-- ============================================================================
create table if not exists public.onboarding_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  applicant_type text not null check (applicant_type in ('courier', 'restaurant')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  full_name text not null,
  phone text not null,
  email text,
  details jsonb not null default '{}'::jsonb,   -- vehicle_type / restaurant name+address+cuisine etc.
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_pending_idx on public.onboarding_applications(created_at desc) where status = 'pending';
alter table public.onboarding_applications enable row level security;
drop policy if exists "onboarding_self_read" on public.onboarding_applications;
create policy "onboarding_self_read" on public.onboarding_applications
  for select using (user_id = auth.uid());
drop policy if exists "onboarding_admin_all" on public.onboarding_applications;
create policy "onboarding_admin_all" on public.onboarding_applications
  for select using (has_role('platform_admin'));

create table if not exists public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.onboarding_applications(id) on delete cascade,
  doc_type text not null,          -- 'id_card' | 'driver_license' | 'restaurant_contract' | ...
  storage_path text not null,
  created_at timestamptz not null default now()
);
alter table public.kyc_documents enable row level security;
drop policy if exists "kyc_self_read" on public.kyc_documents;
create policy "kyc_self_read" on public.kyc_documents
  for select using (exists (select 1 from public.onboarding_applications a where a.id = application_id and a.user_id = auth.uid()));
drop policy if exists "kyc_admin_read" on public.kyc_documents;
create policy "kyc_admin_read" on public.kyc_documents
  for select using (has_role('platform_admin'));

-- submit_onboarding_application: the signed-in user applies (one pending per type).
create or replace function public.submit_onboarding_application(
  p_type text, p_full_name text, p_phone text, p_email text, p_details jsonb
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_type not in ('courier', 'restaurant') then raise exception 'invalid type'; end if;
  if exists (select 1 from public.onboarding_applications where user_id = auth.uid() and applicant_type = p_type and status = 'pending') then
    raise exception 'ai deja o cerere în așteptare';
  end if;
  insert into public.onboarding_applications (user_id, applicant_type, full_name, phone, email, details)
  values (auth.uid(), p_type, p_full_name, p_phone, p_email, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.submit_onboarding_application(text, text, text, text, jsonb) to authenticated;

-- add_kyc_document: link an uploaded storage object to the caller's own application.
create or replace function public.add_kyc_document(p_application_id uuid, p_doc_type text, p_storage_path text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.onboarding_applications a where a.id = p_application_id and a.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  insert into public.kyc_documents (application_id, doc_type, storage_path)
  values (p_application_id, p_doc_type, p_storage_path);
end; $$;
grant execute on function public.add_kyc_document(uuid, text, text) to authenticated;

-- review_onboarding_application: admin approves/rejects. On approve, promotes the
-- applicant (role change is allowed here because this is a definer owned by a
-- bypassrls role → the guard_profile_role trigger permits it) and creates the
-- courier row / restaurant + staff link from the application details.
create or replace function public.review_onboarding_application(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_app public.onboarding_applications%rowtype; v_rid uuid;
begin
  if not has_role('platform_admin') then raise exception 'not authorized'; end if;
  select * into v_app from public.onboarding_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if v_app.status <> 'pending' then raise exception 'already reviewed'; end if;

  if not p_approve then
    update public.onboarding_applications set status = 'rejected', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
    return;
  end if;

  if v_app.user_id is null then raise exception 'applicant user missing'; end if;

  if v_app.applicant_type = 'courier' then
    update public.profiles set role = 'courier' where id = v_app.user_id;
    insert into public.couriers (user_id, full_name, phone, vehicle_type, status, is_active)
    values (v_app.user_id, v_app.full_name, v_app.phone, coalesce(v_app.details ->> 'vehicle_type', 'car'), 'offline', true)
    on conflict (user_id) do nothing;
  else
    update public.profiles set role = 'restaurant_partner' where id = v_app.user_id;
    insert into public.restaurants (slug, name, cuisine_type, address, sector, phone, is_active, accepting_orders, delivery_fee_mdl, min_order_amount_mdl, avg_prep_minutes)
    values (
      coalesce(v_app.details ->> 'slug', 'rest-' || left(v_app.id::text, 8)),
      coalesce(v_app.details ->> 'name', v_app.full_name),
      coalesce(v_app.details ->> 'cuisine_type', 'other'),
      coalesce(v_app.details ->> 'address', ''),
      v_app.details ->> 'sector',
      v_app.phone, false, false,
      coalesce((v_app.details ->> 'delivery_fee_mdl')::numeric, 40),
      coalesce((v_app.details ->> 'min_order_amount_mdl')::numeric, 150),
      coalesce((v_app.details ->> 'avg_prep_minutes')::int, 30)
    ) returning id into v_rid;
    insert into public.restaurant_staff (user_id, restaurant_id) values (v_app.user_id, v_rid) on conflict do nothing;
  end if;

  update public.onboarding_applications set status = 'approved', review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end; $$;
grant execute on function public.review_onboarding_application(uuid, boolean, text) to authenticated;

-- Private KYC storage bucket (documents readable only by owner + admin via signed URLs).
insert into storage.buckets (id, name, public) values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do nothing;
drop policy if exists "kyc_upload_own" on storage.objects;
create policy "kyc_upload_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "kyc_read_own_or_admin" on storage.objects;
create policy "kyc_read_own_or_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'kyc-documents' and ((storage.foldername(name))[1] = auth.uid()::text or has_role('platform_admin')));

notify pgrst, 'reload schema';
