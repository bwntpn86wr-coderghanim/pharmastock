-- Apply AFTER schema.sql to a new project, or review carefully before applying to an existing one.
-- Shared stock uses the existing 'pharmacy' location internally; no separate warehouse balance.
-- All active accounts are peers. Account activation is done by project operator via Supabase SQL Editor.
update public.profiles set role='staff' where role <> 'staff';
alter table public.medicines add column if not exists created_by uuid references auth.users(id);
create or replace function public.stamp_medicine_actor() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if public.my_role() is distinct from 'staff' then raise exception 'Inactive account'; end if;
 new.created_by := auth.uid();
 return new;
end $$;
drop trigger if exists stamp_medicine_actor on public.medicines;
create trigger stamp_medicine_actor before insert on public.medicines for each row execute function public.stamp_medicine_actor();
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.my_role()='staff');
drop policy if exists medicines_write on public.medicines;
create policy medicines_write on public.medicines for insert to authenticated with check (public.my_role()='staff');
drop policy if exists medicines_update on public.medicines;
create policy medicines_update on public.medicines for update to authenticated using (public.my_role()='staff') with check (public.my_role()='staff');
drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated using (public.my_role()='staff');
drop policy if exists items_read on public.sale_items;
create policy items_read on public.sale_items for select to authenticated using (public.my_role()='staff');
drop policy if exists events_read on public.stock_events;
create policy events_read on public.stock_events for select to authenticated using (public.my_role()='staff');
create or replace function public.receive_stock(p_medicine uuid,p_location text,p_qty integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.my_role() is distinct from 'staff' then raise exception 'Not authorized'; end if;
 if p_qty is null or p_qty<=0 or p_qty>1000000 or p_location <> 'pharmacy' then raise exception 'Invalid input'; end if;
 insert into public.stock(medicine_id,location,qty) values(p_medicine,'pharmacy',p_qty)
 on conflict(medicine_id,location) do update set qty=public.stock.qty+excluded.qty;
 insert into public.stock_events(medicine_id,location,delta,reason,actor_id) values(p_medicine,'pharmacy',p_qty,'receive',auth.uid());
end $$;
-- Existing commit_sale already serializes stock updates and records auth.uid();
-- change only its role check to staff-only through a guarded replacement in schema.sql for new installations.
-- Existing role check includes staff, so active peer accounts can sell.
