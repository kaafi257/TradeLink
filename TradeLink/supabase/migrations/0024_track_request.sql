-- "Track request" on the public site: a visitor enters the reference they were given (QTN-XXXXXXXX) and the phone number they used.
-- Both must match, and only the status is returned. Run in the Supabase SQL Editor. Safe to run more than once.
create or replace function public.track_request(p_number text, p_phone text)
returns table (quote_number text, status text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select q.quote_number, q.status, q.created_at
  from public.quotations q
  where upper(btrim(q.quote_number)) = upper(btrim(coalesce(p_number, '')))
    and char_length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 7
    and right(regexp_replace(q.phone, '[^0-9]', '', 'g'), 9) = right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 9)
  limit 1;
$$;
revoke all on function public.track_request(text, text) from public;
grant execute on function public.track_request(text, text) to anon, authenticated;
