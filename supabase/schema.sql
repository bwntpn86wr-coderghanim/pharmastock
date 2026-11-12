-- Run in a NEW Supabase project. Review before executing.
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '',
 role text not null default 'staff' check (role in ('owner','manager','pharmacist','warehouse','staff')),
 active boolean not null default false
);
create table public.medicines (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 barcode text not null unique,
 purchase_price numeric(14,2) not null default 0 check(purchase_price>=0),
 sale_price numeric(14,2) not null default 0 check(sale_price>=0),
 created_at timestamptz not null default now()
);
create table public.stock (
 medicine_id uuid not null references public.medicines(id),
 location text not null check(location in ('pharmacy','warehouse')),
 qty integer not null default 0 check(qty>=0),
 primary key(medicine_id,location)
);
create table public.sales (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 location text not null check(location in ('pharmacy','warehouse')),
 total numeric(14,2) not null,
 created_at timestamptz not null default now()
);
create table public.sale_items (
 sale_id uuid not null references public.sales(id),
 medicine_id uuid not null references public.medicines(id),
 qty integer not null check(qty>0),
 unit_price numeric(14,2) not null check(unit_price>=0),
 unit_cost numeric(14,2) not null check(unit_cost>=0),
 primary key(sale_id,medicine_id)
);
create table public.stock_events (
 id uuid primary key default gen_random_uuid(),
 medicine_id uuid not null references public.medicines(id),
 location text not null,
 delta integer not null,
 reason text not null,
 reference_id uuid,
 actor_id uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index on public.stock_events(medicine_id,created_at);
create or replace function public.my_role() returns text language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() and active=true
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;
create or replace function public.on_user_created() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''));
 return new;
end $$;
create trigger create_profile after insert on auth.users for each row execute function public.on_user_created();
alter table public.profiles enable row level security;
alter table public.medicines enable row level security;
alter table public.stock enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_events enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.my_role() in ('owner','manager'));
create policy medicines_read on public.medicines for select to authenticated using(public.my_role() is not null);
create policy medicines_write on public.medicines for insert to authenticated with check(public.my_role() in ('owner','manager','warehouse'));
create policy medicines_update on public.medicines for update to authenticated using(public.my_role() in ('owner','manager','warehouse')) with check(public.my_role() in ('owner','manager','warehouse'));
create policy stock_read on public.stock for select to authenticated using(public.my_role() is not null);
create policy sales_read on public.sales for select to authenticated using(public.my_role() in ('owner','manager') or user_id=auth.uid());
create policy items_read on public.sale_items for select to authenticated using(exists(select 1 from public.sales s where s.id=sale_id and (s.user_id=auth.uid() or public.my_role() in ('owner','manager'))));
create policy events_read on public.stock_events for select to authenticated using(public.my_role() in ('owner','manager','warehouse'));
-- All stock mutations happen through privileged RPCs, never direct client table writes.
create or replace function public.receive_stock(p_medicine uuid,p_location text,p_qty integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.my_role() not in ('owner','manager','warehouse') then raise exception 'Not authorized'; end if;
 if p_qty<=0 or p_qty>1000000 or p_location not in ('pharmacy','warehouse') then raise exception 'Invalid input'; end if;
 insert into public.stock(medicine_id,location,qty) values(p_medicine,p_location,p_qty)
 on conflict(medicine_id,location) do update set qty=public.stock.qty+excluded.qty;
 insert into public.stock_events(medicine_id,location,delta,reason,actor_id) values(p_medicine,p_location,p_qty,'receive',auth.uid());
end $$;
create or replace function public.commit_sale(p_id uuid,p_location text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item jsonb; v_med uuid; v_qty integer; v_price numeric; v_cost numeric; v_total numeric:=0; v_existing public.sales%rowtype;
begin
 if public.my_role() not in ('owner','manager','pharmacist','staff') then raise exception 'Not authorized'; end if;
 if p_location <> 'pharmacy' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then raise exception 'Invalid sale'; end if;
 select * into v_existing from public.sales where id=p_id;
 if found then
  if v_existing.user_id<>auth.uid() then raise exception 'Sale ID already used'; end if;
  return jsonb_build_object('status','already_saved','id',p_id);
 end if;
 -- Lock all referenced stock rows in stable order to serialize concurrent sales.
 perform 1 from public.stock where location=p_location and medicine_id in (select distinct (value->>'medicine_id')::uuid from jsonb_array_elements(p_items)) order by medicine_id for update;
 -- Prevent duplicate medicine lines, and validate inputs.
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct value->>'medicine_id') from jsonb_array_elements(p_items)) then raise exception 'Duplicate item'; end if;
 insert into public.sales(id,user_id,location,total) values(p_id,auth.uid(),p_location,0);
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_med:=(v_item->>'medicine_id')::uuid; v_qty:=(v_item->>'qty')::integer;
  if v_qty is null or v_qty<=0 or v_qty>100000 then raise exception 'Invalid quantity'; end if;
  select sale_price,purchase_price into v_price,v_cost from public.medicines where id=v_med;
  if not found then raise exception 'Medicine not found'; end if;
  update public.stock set qty=qty-v_qty where medicine_id=v_med and location=p_location and qty>=v_qty;
  if not found then raise exception 'Insufficient stock for %',v_med; end if;
  insert into public.sale_items(sale_id,medicine_id,qty,unit_price,unit_cost) values(p_id,v_med,v_qty,v_price,v_cost);
  insert into public.stock_events(medicine_id,location,delta,reason,reference_id,actor_id) values(v_med,p_location,-v_qty,'sale',p_id,auth.uid());
  v_total:=v_total+v_qty*v_price;
 end loop;
 update public.sales set total=v_total where id=p_id;
 return jsonb_build_object('status','saved','id',p_id,'total',v_total);
end $$;
revoke all on function public.receive_stock(uuid,text,integer) from public,anon;
revoke all on function public.commit_sale(uuid,text,jsonb) from public,anon;
grant execute on function public.receive_stock(uuid,text,integer) to authenticated;
grant execute on function public.commit_sale(uuid,text,jsonb) to authenticated;
-- After registering the FIRST owner, run once in SQL Editor:
-- update public.profiles set role='owner', active=true where id=(select id from auth.users where email='YOUR_EMAIL');
-- For subsequent employees, create their auth user and approve role+active in SQL Editor.
