-- A supplier can list a product under any active category, from their own industry or any other. The portal shows their own industry first.
create or replace function public.supplier_products_check_category()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_active boolean;
begin
  if new.category_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then return new; end if;
  v_active := (select active from public.categories where id = new.category_id);
  if v_active is null then raise exception 'That category was not found. Choose another one.'; end if;
  if not v_active then raise exception 'That category is no longer available. Choose another one.'; end if;
  return new;
end;
$$;
