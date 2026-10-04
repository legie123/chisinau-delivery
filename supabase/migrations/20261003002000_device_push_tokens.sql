-- Native push (Expo) for the courier/client apps.
--
-- The web stores Web Push endpoints (VAPID) in push_subscriptions; a native app
-- has no endpoint, it has an Expo push token, delivered through the Expo push
-- API. Same outbox, same drain route (src/app/api/push/drain/route.ts), a second
-- fan-out target.
--
-- Writes go ONLY through register_device_push_token(): a phone that changes
-- hands (courier logs out, another logs in) must move the token to the new
-- user — that is a write on another user's row, so it is a SECURITY DEFINER RPC,
-- never a client upsert (hard rule 4). Clients may read and delete their own
-- rows (logout = unregister). The drain prunes DeviceNotRegistered tokens with
-- the service role. Rows die with the auth user (on delete cascade).

create table if not exists public.device_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  expo_token    text not null unique
                check (expo_token ~ '^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$'),
  platform      text not null check (platform in ('ios', 'android')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

revoke all on public.device_push_tokens from anon, authenticated;
grant select, delete on public.device_push_tokens to authenticated;

drop policy if exists "device_push_tokens_self_read" on public.device_push_tokens;
create policy "device_push_tokens_self_read" on public.device_push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('platform_admin')));

drop policy if exists "device_push_tokens_self_delete" on public.device_push_tokens;
create policy "device_push_tokens_self_delete" on public.device_push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Idempotent: the app calls this on every launch (refreshes last_seen_at).
create or replace function public.register_device_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'neautentificat' using errcode = '42501';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'platformă invalidă: %', p_platform;
  end if;

  insert into public.device_push_tokens (user_id, expo_token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (expo_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now();
end;
$$;

revoke execute on function public.register_device_push_token(text, text) from public, anon;
grant execute on function public.register_device_push_token(text, text) to authenticated;
