-- Rollback of 20261012000209_courier_release_order. Drops the release RPC, its log and policy tables, and puts the
-- dispatch_errors phase check back to (expire, sweep). Fails if a dispatch_errors row has phase 'release':
-- delete or re-label it first. Released orders stay as they are (back in ready_for_pickup / re-dispatched).
drop function public.courier_release_order(uuid, text);
drop function public.set_courier_release_policy(integer, text);
drop function public.current_courier_release_policy();
drop table public.courier_order_releases;
drop table public.courier_release_policy;
drop function public.guard_courier_release_policy_immutable();
alter table public.dispatch_errors drop constraint dispatch_errors_phase_check,
  add constraint dispatch_errors_phase_check check (phase in ('expire', 'sweep'));
