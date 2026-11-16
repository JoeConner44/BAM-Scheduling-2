-- QuickBooks Online connector storage. Run once in the Supabase SQL Editor.
-- Both tables have row-level security ON and NO policies: only the "quickbooks" Edge Function
-- (service role) can read or write them. Staff logins and customers cannot see the tokens.

create table if not exists public.qbo_tokens (
  id                 int primary key default 1 check (id = 1),
  realm_id           text,
  company_name       text,
  access_token       text,
  refresh_token      text,
  access_expires_at  timestamptz,
  refresh_expires_at timestamptz,
  updated_at         timestamptz not null default now()
);

create table if not exists public.qbo_state (
  state      text primary key,
  created_at timestamptz not null default now()
);

alter table public.qbo_tokens enable row level security;
alter table public.qbo_state  enable row level security;
revoke all on public.qbo_tokens, public.qbo_state from anon, authenticated;
