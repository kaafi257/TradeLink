-- Newsletter sign-ups from the public homepage. Run after 0018. Safe to run more than once.
-- Visitors can only add their own email through subscribe_newsletter(); nobody but staff with website.manage can read the list.
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);
create unique index if not exists newsletter_email_unique on public.newsletter_subscribers (lower(email));
alter table public.newsletter_subscribers enable row level security;
drop policy if exists "Website managers read subscribers" on public.newsletter_subscribers;
create policy "Website managers read subscribers" on public.newsletter_subscribers for select to authenticated using (public.has_permission('website.manage'));
drop policy if exists "Website managers remove subscribers" on public.newsletter_subscribers;
create policy "Website managers remove subscribers" on public.newsletter_subscribers for delete to authenticated using (public.has_permission('website.manage'));
revoke all on public.newsletter_subscribers from anon, authenticated;
grant select, delete on public.newsletter_subscribers to authenticated;

create or replace function public.subscribe_newsletter(p_email text, p_website text default '') returns text
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if btrim(coalesce(p_website, '')) <> '' then return 'ok'; end if;                       -- hidden field filled in: a bot, pretend it worked
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 160 then raise exception 'Please enter a valid email address.'; end if;
  if (select count(*) from public.newsletter_subscribers where created_at > now() - interval '1 minute') > 30 then raise exception 'Please try again in a minute.'; end if;
  insert into public.newsletter_subscribers (email) values (v_email) on conflict do nothing;
  return 'ok';                                                                               -- same answer whether or not it was already there
end $$;
revoke execute on function public.subscribe_newsletter(text, text) from public;
grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;
