-- Run only after creating THREE users under Supabase Authentication > Users.
-- Replace example emails with the three real account emails.
-- All three have equal 'staff' permissions. No passwords are stored in this SQL.
update public.profiles p
set role='staff', active=true,
    display_name=case u.email
      when 'rep1@example.com' then 'مندوب 1'
      when 'rep2@example.com' then 'مندوب 2'
      when 'rep3@example.com' then 'مندوب 3'
      else p.display_name end
from auth.users u
where p.id=u.id
  and u.email in ('rep1@example.com','rep2@example.com','rep3@example.com');

-- Verify exactly three rows appear and active=true:
select u.email,p.display_name,p.role,p.active
from public.profiles p join auth.users u on u.id=p.id
where u.email in ('rep1@example.com','rep2@example.com','rep3@example.com');
