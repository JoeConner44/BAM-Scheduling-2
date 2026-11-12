-- AsphaltPro shared backend for Supabase. Run once in: Supabase dashboard -> SQL Editor.
-- Staff (logged-in, on the allowlist) get full access. Customers get NO table access;
-- they reach only their own sanitized data through the portal_* functions below,
-- using their private portal token.

create table if not exists public.records (
  coll       text  not null,
  id         text  not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists records_portal_token on public.records ((data->>'portalToken')) where coll = 'customers';

create table if not exists public.portal_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  customer_id text not null,
  kind        text not null,          -- signed | message | pay_request
  payload     jsonb not null default '{}'
);

create table if not exists public.staff (email text primary key);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records for each row execute function public.touch_updated_at();

-- Staff allowlist check (works even if public sign-ups are enabled)
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
create or replace function public.am_i_staff() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_staff() $$;

alter table public.records       enable row level security;
alter table public.portal_events enable row level security;
alter table public.staff         enable row level security;   -- no policies: only the dashboard/service role edits it

drop policy if exists staff_all on public.records;
create policy staff_all on public.records       for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists staff_all on public.portal_events;
create policy staff_all on public.portal_events for all to authenticated using (public.is_staff()) with check (public.is_staff());

revoke all on public.records, public.portal_events, public.staff from anon;

-- ---------------- customer portal API (token = the credential) ----------------
create or replace function public._portal_customer(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select data from public.records
   where coll = 'customers' and length(coalesce(p_token, '')) >= 32 and data->>'portalToken' = p_token
   limit 1
$$;
revoke execute on function public._portal_customer(text) from public, anon, authenticated;

create or replace function public.portal_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; cid text;
begin
  c := public._portal_customer(p_token);
  if c is null then return null; end if;
  cid := c->>'id';
  return jsonb_build_object(
    'customer', jsonb_build_object('id', c->'id', 'name', c->'name', 'contact', c->'contact', 'email', c->'email', 'phone', c->'phone', 'address', c->'address', 'status', c->'status'),
    'settings', (select data from public.records where coll = 'meta' and id = 'settings'),
    'estimates', coalesce((select jsonb_agg(data order by (data->>'number')::int) from public.records
                            where coll = 'estimates' and data->>'customerId' = cid and data->>'status' <> 'draft'), '[]'::jsonb),
    'invoices',  coalesce((select jsonb_agg(data order by (data->>'number')::int) from public.records
                            where coll = 'invoices' and data->>'customerId' = cid and data->>'status' <> 'draft'), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
                'id', r.data->'id', 'name', r.data->'name', 'customerId', r.data->'customerId', 'estimateId', r.data->'estimateId',
                'address', r.data->'address', 'status', r.data->'status', 'date', r.data->'date', 'days', r.data->'days',
                'logs',   (select coalesce(jsonb_agg(jsonb_build_object('date', l->'date', 'text', l->'text', 'weather', l->'weather')), '[]'::jsonb)
                             from jsonb_array_elements(coalesce(r.data->'logs', '[]'::jsonb)) l),
                'photos', (select coalesce(jsonb_agg(p order by n), '[]'::jsonb) from (
                              select p, n from jsonb_array_elements(coalesce(r.data->'photos', '[]'::jsonb)) with ordinality t(p, n) order by n desc limit 4) s)
              )) from public.records r where r.coll = 'jobs' and r.data->>'customerId' = cid), '[]'::jsonb)
  );
end $$;

create or replace function public.portal_sign(p_token text, p_estimate_id text, p_name text, p_img text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c jsonb; d text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
begin
  c := public._portal_customer(p_token);
  if c is null then return false; end if;
  if length(coalesce(trim(p_name), '')) = 0 then raise exception 'name required'; end if;
  if length(coalesce(p_img, '')) > 400000 then raise exception 'signature too large'; end if;
  update public.records set data = data || jsonb_build_object(
      'status', 'signed', 'signedAt', d, 'autoRan', false,
      'signature', jsonb_build_object('name', left(trim(p_name), 120), 'date', d, 'img', nullif(p_img, '')))
   where coll = 'estimates' and id = p_estimate_id and data->>'customerId' = c->>'id' and data->>'status' = 'sent';
  if not found then return false; end if;
  insert into public.portal_events (customer_id, kind, payload) values (c->>'id', 'signed', jsonb_build_object('estimateId', p_estimate_id));
  return true;
end $$;

create or replace function public.portal_message(p_token text, p_text text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  c := public._portal_customer(p_token);
  if c is null or length(coalesce(trim(p_text), '')) = 0 then return false; end if;
  if (select count(*) from public.portal_events where customer_id = c->>'id' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many requests, try again later';
  end if;
  insert into public.portal_events (customer_id, kind, payload) values (c->>'id', 'message', jsonb_build_object('text', left(p_text, 2000)));
  return true;
end $$;

create or replace function public.portal_pay_request(p_token text, p_invoice_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  c := public._portal_customer(p_token);
  if c is null then return false; end if;
  if not exists (select 1 from public.records where coll = 'invoices' and id = p_invoice_id and data->>'customerId' = c->>'id') then return false; end if;
  if (select count(*) from public.portal_events where customer_id = c->>'id' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many requests, try again later';
  end if;
  insert into public.portal_events (customer_id, kind, payload) values (c->>'id', 'pay_request', jsonb_build_object('invoiceId', p_invoice_id));
  return true;
end $$;

grant execute on function public.portal_get(text), public.portal_sign(text, text, text, text),
                          public.portal_message(text, text), public.portal_pay_request(text, text) to anon, authenticated;
grant execute on function public.am_i_staff() to authenticated;
revoke execute on function public.is_staff(), public.am_i_staff(), public.touch_updated_at() from public;
grant execute on function public.is_staff(), public.am_i_staff() to authenticated;

-- AFTER running this file, add yourself as staff (use the email you will log in with):
--   insert into public.staff(email) values ('you@yourcompany.com');
