-- Rollback of 20261012000309: back to the default PUBLIC execute (re-opens sim 73.a3).
grant execute on function public.clear_pin_confirmation_on_move() to public;
