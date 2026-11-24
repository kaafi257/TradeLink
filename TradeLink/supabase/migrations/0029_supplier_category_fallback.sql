-- A supplier lists products under a category of their own industry. If their industry has no categories yet (or they have no industry set),
-- any active category is allowed, matching what the supplier portal offers, so they are never stuck. Products saved earlier are unaffected.
create or replace function public.supplier_products_check_category()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ind uuid; v_cat_ind uuid; v_active boolean; v_has boolean;
begin
  if new.category_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then return new; end if;
  v_ind := (select industry_id from public.suppliers where id = new.supplier_id);
  v_cat_ind := (select industry_id from public.categories where id = new.category_id);
  v_active := (select active from public.categories where id = new.category_id);
  if v_active is null then raise exception 'That category was not found. Choose another one.'; end if;
  v_has := v_ind is not null and exists (select 1 from public.categories where industry_id = v_ind and active);
  if v_has and v_cat_ind is distinct from v_ind then raise exception 'Choose a category from your own industry.'; end if;
  if not v_active then raise exception 'That category is no longer available. Choose another one.'; end if;
  return new;
end;
$$;
