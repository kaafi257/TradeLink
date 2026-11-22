-- TradeLink: let a customer see their own checkout orders with the NAME and PHONE NUMBER they ordered with (no email or password needed).
-- Run ONCE in Supabase -> SQL Editor, AFTER 0026. Safe to run more than once. Additive.
-- Both the full name and the phone must match an order, so one detail alone shows nothing. Returns only checkout orders, newest first.
create or replace function public.orders_by_contact(p_name text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'); v_name text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
begin
  if char_length(v_phone) < 9 or char_length(v_name) < 2 then raise exception 'Enter the full name and the phone number you ordered with.'; end if;
  return coalesce((
    select jsonb_agg(public.order_view(o.id) order by o.created_at desc)
    from (select id, created_at from public.orders
          where channel = 'checkout' and right(phone, 9) = right(v_phone, 9)
            and lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g')) = v_name
          order by created_at desc limit 50) o), '[]'::jsonb);
end $$;
revoke execute on function public.orders_by_contact(text, text) from public;
grant execute on function public.orders_by_contact(text, text) to anon, authenticated;
