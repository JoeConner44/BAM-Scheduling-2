-- Roles + crew time tracking. Run once in the Supabase SQL Editor (safe to re-run).
--
-- Roles (public.staff.role):
--   owner       everything, plus managing the team
--   office      everything except managing the team
--   bookkeeper  same data access as office (the app shows them the money pages)
--   estimator   cannot read or change invoices or the private settings (API keys, pay rates)
--   crew        NO access to the data tables at all. Crew phones use the crew_* functions below, which hand back
--               only job-site information (no prices, costs, contracts or other customers) and record their time.

alter table public.staff add column if not exists role text not null default 'office';
alter table public.staff add column if not exists name text;
alter table public.staff add column if not exists crew_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_role_check') then
    alter table public.staff add constraint staff_role_check check (role in ('owner', 'office', 'bookkeeper', 'estimator', 'crew'));
  end if;
end $$;
-- whoever was on the list first becomes the owner if there is no owner yet
update public.staff set role = 'owner'
 where email = (select email from public.staff order by ctid limit 1)
   and not exists (select 1 from public.staff where role = 'owner');

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1
$$;
-- "staff" for table access = every role except crew
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner', 'office', 'bookkeeper', 'estimator'), false)
$$;
-- login gate: anyone on the team list, crew included
create or replace function public.am_i_staff() returns boolean
language sql stable security definer set search_path = public as $$ select public.my_role() is not null $$;

drop policy if exists staff_all on public.records;
create policy staff_all on public.records for all to authenticated
  using (case (select public.my_role())
           when 'owner' then true when 'office' then true when 'bookkeeper' then true
           when 'estimator' then coll <> 'invoices' and not (coll = 'meta' and id = 'private')
           else false end)
  with check (case (select public.my_role())
           when 'owner' then true when 'office' then true when 'bookkeeper' then true
           when 'estimator' then coll <> 'invoices' and not (coll = 'meta' and id = 'private')
           else false end);

-- the team list itself: only the owner can see or change it
drop policy if exists staff_owner on public.staff;
create policy staff_owner on public.staff for all to authenticated
  using ((select public.my_role()) = 'owner') with check ((select public.my_role()) = 'owner');
grant select, insert, update, delete on public.staff to authenticated;

-- ---------------- crew functions ----------------
create or replace function public._crew_me() returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff;
begin
  select * into s from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;
  if s.email is null then raise exception 'not on the team list'; end if;
  return s;
end $$;
revoke execute on function public._crew_me() from public, anon, authenticated;

create or replace function public._crew_job(d jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d->'id', 'name', d->'name', 'address', d->'address', 'status', d->'status', 'date', d->'date', 'days', d->'days', 'crewId', d->'crewId',
    'notes', d->'notes', 'checklist', coalesce(d->'checklist', '[]'::jsonb),
    'customer', (select c.data->>'name' from public.records c where c.coll = 'customers' and c.id = d->>'customerId'),
    'logs', (select coalesce(jsonb_agg(l order by n), '[]'::jsonb) from (select l, n from jsonb_array_elements(coalesce(d->'logs', '[]'::jsonb)) with ordinality t(l, n) order by n desc limit 5) s),
    'photoCount', jsonb_array_length(coalesce(d->'photos', '[]'::jsonb)))
$$;
revoke execute on function public._crew_job(jsonb) from public, anon, authenticated;

create or replace function public.crew_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public._crew_me();
begin
  return jsonb_build_object(
    'me', jsonb_build_object('email', me.email, 'name', me.name, 'role', me.role, 'crewId', me.crew_id),
    'company', (select data->>'company' from public.records where coll = 'meta' and id = 'settings'),
    'crews', coalesce((select jsonb_agg(data) from public.records where coll = 'crews'), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(public._crew_job(data)) from public.records
                       where coll = 'jobs' and data->>'status' in ('scheduled', 'in-progress')), '[]'::jsonb),
    'time', coalesce((select jsonb_agg(data order by data->>'start' desc) from public.records
                       where coll = 'time' and lower(data->>'email') = lower(me.email)
                         and (data->>'end' is null or data->>'date' >= to_char(now() - interval '21 days', 'YYYY-MM-DD'))), '[]'::jsonb));
end $$;

create or replace function public.crew_clock_in(p_job text, p_date text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.staff := public._crew_me(); j jsonb; e jsonb; tid text := 't_' || replace(gen_random_uuid()::text, '-', '');
begin
  if exists (select 1 from public.records where coll = 'time' and lower(data->>'email') = lower(me.email) and data->>'end' is null) then
    raise exception 'You are already clocked in. Clock out first.';
  end if;
  select data into j from public.records where coll = 'jobs' and id = p_job;
  if j is null then raise exception 'Job not found'; end if;
  if p_date !~ '^\d{4}-\d\d-\d\d$' then p_date := to_char(now(), 'YYYY-MM-DD'); end if;
  e := jsonb_build_object('id', tid, 'jobId', p_job, 'email', lower(me.email), 'name', coalesce(nullif(me.name, ''), me.email),
                          'date', p_date, 'start', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', null, 'hours', 0, 'note', '', 'source', 'crew');
  insert into public.records (coll, id, data) values ('time', tid, e);
  if j->>'status' = 'scheduled' then update public.records set data = data || '{"status":"in-progress"}'::jsonb where coll = 'jobs' and id = p_job; end if;
  return e;
end $$;

create or replace function public.crew_clock_out(p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.staff := public._crew_me(); r record; e jsonb;
begin
  select id, data into r from public.records where coll = 'time' and lower(data->>'email') = lower(me.email) and data->>'end' is null order by data->>'start' desc limit 1;
  if r.id is null then raise exception 'You are not clocked in.'; end if;
  e := r.data || jsonb_build_object('end', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'hours', round((extract(epoch from (now() - (r.data->>'start')::timestamptz)) / 3600.0)::numeric, 2),
         'note', left(coalesce(p_note, ''), 500));
  update public.records set data = e where coll = 'time' and id = r.id;
  return e;
end $$;

create or replace function public.crew_check(p_job text, p_index int, p_done boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._crew_me();
  update public.records set data = jsonb_set(data, array['checklist', p_index::text, 'done'], to_jsonb(p_done))
   where coll = 'jobs' and id = p_job and p_index >= 0 and jsonb_array_length(coalesce(data->'checklist', '[]'::jsonb)) > p_index;
  return found;
end $$;

create or replace function public.crew_log(p_job text, p_date text, p_text text, p_weather text, p_tons numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare me public.staff := public._crew_me();
begin
  if length(coalesce(trim(p_text), '')) = 0 then raise exception 'Write a note first'; end if;
  update public.records set data = data
      || jsonb_build_object('logs', coalesce(data->'logs', '[]'::jsonb) || jsonb_build_object(
           'id', 'g_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'date', p_date, 'weather', left(coalesce(p_weather, ''), 80),
           'crew', 0, 'tons', coalesce(p_tons, 0), 'text', left(p_text, 2000), 'by', coalesce(nullif(me.name, ''), me.email)))
      || case when data->>'status' = 'scheduled' then '{"status":"in-progress"}'::jsonb else '{}'::jsonb end
   where coll = 'jobs' and id = p_job;
  return found;
end $$;

create or replace function public.crew_photo(p_job text, p_date text, p_src text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._crew_me();
  if p_src !~ '^data:image/' or length(p_src) > 700000 then raise exception 'Photo is too large or not an image'; end if;
  update public.records set data = data || jsonb_build_object('photos', coalesce(data->'photos', '[]'::jsonb) || jsonb_build_object(
           'id', 'p_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'date', p_date, 'src', p_src))
   where coll = 'jobs' and id = p_job;
  return found;
end $$;

revoke execute on function public.my_role(), public.crew_get(), public.crew_clock_in(text, text), public.crew_clock_out(text),
  public.crew_check(text, int, boolean), public.crew_log(text, text, text, text, numeric), public.crew_photo(text, text, text) from public, anon;
grant execute on function public.my_role(), public.is_staff(), public.am_i_staff(), public.crew_get(), public.crew_clock_in(text, text), public.crew_clock_out(text),
  public.crew_check(text, int, boolean), public.crew_log(text, text, text, text, numeric), public.crew_photo(text, text, text) to authenticated;
