-- Run in Supabase SQL Editor. Safe migration for existing AI Hub installs.
create table if not exists public.chats (
 id uuid primary key,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null default 'New conversation',
 messages jsonb not null default '[]'::jsonb,
 updated_at timestamptz not null default now()
);
create table if not exists public.chat_folders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 80),
 updated_at timestamptz not null default now()
);
alter table public.chats add column if not exists folder_id uuid references public.chat_folders(id) on delete set null;
alter table public.chats alter column user_id set default auth.uid();
alter table public.chat_folders enable row level security;
alter table public.chats enable row level security;
drop policy if exists "Own chats read" on public.chats;
drop policy if exists "Own chats insert" on public.chats;
drop policy if exists "Own chats update" on public.chats;
drop policy if exists "Own chats delete" on public.chats;
create policy "Own chats read" on public.chats for select to authenticated using (user_id=auth.uid());
create policy "Own chats insert" on public.chats for insert to authenticated with check (user_id=auth.uid());
create policy "Own chats update" on public.chats for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "Own chats delete" on public.chats for delete to authenticated using (user_id=auth.uid());
drop policy if exists "Own folders read" on public.chat_folders;
drop policy if exists "Own folders insert" on public.chat_folders;
drop policy if exists "Own folders update" on public.chat_folders;
drop policy if exists "Own folders delete" on public.chat_folders;
create policy "Own folders read" on public.chat_folders for select to authenticated using (user_id=auth.uid());
create policy "Own folders insert" on public.chat_folders for insert to authenticated with check (user_id=auth.uid());
create policy "Own folders update" on public.chat_folders for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "Own folders delete" on public.chat_folders for delete to authenticated using (user_id=auth.uid());
create index if not exists chats_user_updated on public.chats(user_id,updated_at desc);
create index if not exists chats_user_folder on public.chats(user_id,folder_id);
create index if not exists chat_folders_user_name on public.chat_folders(user_id,name);
-- Ensure the signed-in role has table privileges; RLS still limits rows to the owner.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.chats to authenticated;
grant select, insert, update, delete on public.chat_folders to authenticated;

-- ============================================================================
-- Token usage tracking + synced settings (added in this update)
-- Safe to re-run. Run the whole file in the Supabase SQL Editor.
-- ============================================================================

-- One row per model response. Written by the Netlify function under the signed-in user's own session.
create table if not exists public.token_usage (
 id bigint generated always as identity primary key,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 provider text not null,
 model text not null,
 input_tokens integer not null default 0,
 output_tokens integer not null default 0,
 total_tokens integer not null default 0,
 estimated boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists token_usage_user_time on public.token_usage(user_id, created_at desc);
alter table public.token_usage enable row level security;
drop policy if exists "Own usage read" on public.token_usage;
drop policy if exists "Own usage insert" on public.token_usage;
drop policy if exists "Own usage delete" on public.token_usage;
create policy "Own usage read" on public.token_usage for select to authenticated using (user_id=auth.uid());
create policy "Own usage insert" on public.token_usage for insert to authenticated with check (user_id=auth.uid());
create policy "Own usage delete" on public.token_usage for delete to authenticated using (user_id=auth.uid());
grant select, insert, delete on public.token_usage to authenticated;

-- Per-user settings that follow the login across devices (token limits, plain-text display preference).
create table if not exists public.user_settings (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 settings jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "Own settings read" on public.user_settings;
drop policy if exists "Own settings insert" on public.user_settings;
drop policy if exists "Own settings update" on public.user_settings;
create policy "Own settings read" on public.user_settings for select to authenticated using (user_id=auth.uid());
create policy "Own settings insert" on public.user_settings for insert to authenticated with check (user_id=auth.uid());
create policy "Own settings update" on public.user_settings for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
grant select, insert, update on public.user_settings to authenticated;

-- Totals per provider/model for the day, week and month windows the browser passes in.
-- Aggregating here avoids Supabase's default 1,000-row API response cap.
create or replace function public.token_usage_totals(day_start timestamptz, week_start timestamptz, month_start timestamptz)
returns table(provider text, model text, period text, input_tokens bigint, output_tokens bigint, total_tokens bigint, requests bigint, estimated_count bigint)
language sql stable security invoker set search_path = public as $$
 select t.provider, t.model, p.period,
        coalesce(sum(t.input_tokens),0)::bigint, coalesce(sum(t.output_tokens),0)::bigint, coalesce(sum(t.total_tokens),0)::bigint,
        count(*)::bigint, (count(*) filter (where t.estimated))::bigint
 from public.token_usage t
 cross join lateral (values ('day', day_start), ('week', week_start), ('month', month_start)) as p(period, start_ts)
 where t.user_id = auth.uid() and t.created_at >= p.start_ts
 group by t.provider, t.model, p.period
$$;
grant execute on function public.token_usage_totals(timestamptz, timestamptz, timestamptz) to authenticated;
