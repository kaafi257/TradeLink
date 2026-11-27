-- Driver verification for owner and manager: every delivery-role account is listed (even before the driver first goes online),
-- and can be marked verified or not. ADDITIVE: replaces ops_drivers (same name and result type) and adds ops_verify_driver.

create or replace function public.ops_drivers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profileId', p.id, 'id', a.id, 'name', coalesce(nullif(btrim(a.name), ''), nullif(btrim(p.full_name), ''), p.email), 'email', p.email,
      'phone', a.phone, 'vehicle', coalesce(a.vehicle, 'Motorbike'), 'plate', a.plate, 'verified', coalesce(a.verified, false), 'hasPhoto', a.photo is not null,
      'deliveries', (select count(*) from public.deliveries d where d.assigned_to = p.id and d.status = 'delivered')) order by coalesce(a.verified, false), p.email)
    from public.profiles p left join public.delivery_agents a on a.profile_id = p.id
    where p.role = 'delivery' and p.active = true
  ), '[]'::jsonb);
end $$;

create or replace function public.ops_verify_driver(p_profile uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles%rowtype;
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  v_p := (select p from public.profiles p where p.id = p_profile and p.active = true and p.role = 'delivery');
  if v_p.id is null then raise exception 'Driver not found.'; end if;
  insert into public.delivery_agents (profile_id, name, status, verified)
  values (v_p.id, coalesce(nullif(btrim(v_p.full_name), ''), v_p.email, 'Driver'), 'offline', coalesce(p_verified, false))
  on conflict (profile_id) do update set verified = coalesce(p_verified, false);
  perform public.notify(v_p.id, 'driver_verified', case when coalesce(p_verified, false) then 'You are now a verified driver' else 'Your driver verification was removed' end, null, '/admin/deliveries');
end $$;
revoke all on function public.ops_verify_driver(uuid, boolean) from public, anon;
grant execute on function public.ops_verify_driver(uuid, boolean) to authenticated;
