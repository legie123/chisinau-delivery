-- In-app account deletion for customers (C3; App Store guideline 5.1.1(v): an app that lets people
-- create an account must let them delete it in the app). erase_customer_pii had no caller and left
-- the login itself, the address contact phones, the per-dish notes and the push tokens.
-- delete_my_account(): the signed-in CUSTOMER, for themselves only.
--   * refused while an order is in flight (the courier and restaurant still need the contact);
--   * refused for courier / restaurant / admin roles (other obligations, handled by ops);
--   * erase_customer_pii + address contact phones + order/item notes + push tokens + web push
--     subscriptions + favorites + unsent notifications;
--   * the auth account is ANONYMIZED, not deleted: orders reference auth.users without cascade and are
--     kept for fiscal retention. Email replaced, password emptied, metadata cleared, banned forever,
--     every session and identity removed — nobody can sign in to it again.
-- Rollback: drop function public.delete_my_account();

create or replace function public.delete_my_account()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.profiles where id = v_uid and role <> 'customer') then
    raise exception 'Contul de curier sau de partener se închide prin echipa noastră — scrie-ne.';
  end if;
  if exists (select 1 from public.orders where customer_id = v_uid
             and status not in ('delivered', 'cancelled', 'rejected')) then
    raise exception 'Ai o comandă în curs — contul se poate șterge după ce se încheie.';
  end if;

  perform public.erase_customer_pii(v_uid);
  update public.addresses set contact_phone = null where customer_id = v_uid;
  update public.orders set notes = null where customer_id = v_uid and notes is not null;
  update public.order_items oi set notes = null
    from public.orders o where o.id = oi.order_id and o.customer_id = v_uid and oi.notes is not null;
  delete from public.device_push_tokens where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.favorites where customer_id = v_uid;
  delete from public.notification_outbox where user_id = v_uid and sent_at is null;

  delete from auth.sessions where user_id = v_uid;
  delete from auth.identities where user_id = v_uid;
  update auth.users
     set email = 'sters-' || v_uid::text || '@deleted.invalid',
         phone = null,
         encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb,
         email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         phone_change = '',
         phone_change_token = '',
         banned_until = 'infinity',
         deleted_at = now()
   where id = v_uid;
end; $function$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
