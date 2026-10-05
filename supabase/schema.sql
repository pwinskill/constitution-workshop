-- malariasimulation constitution workshop: database setup for Supabase.
--
-- Run once: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- It is safe to run again (it won't delete data).
--
-- Every row carries a `workshop` id (from data/workshop.json, or ?ws= in the URL),
-- so a practice run and the real workshop can share the same tables.
--
-- Access: the app has no logins, so the publishable/anon key may read and write
-- these four tables. Anyone who has the site URL can therefore see or change
-- workshop data; don't collect anything sensitive. After the workshop, run the
-- "lock" block at the bottom to make everything read-only.

create table if not exists public.participants (
  workshop    text        not null,
  code        text        not null,
  name        text        not null,
  cases       text[]      not null default '{}',
  guest       boolean     not null default false,
  created_at  timestamptz not null default now(),
  primary key (workshop, code)
);

create table if not exists public.responses (
  id               uuid        primary key default gen_random_uuid(),
  workshop         text        not null,
  participant_code text        not null,
  case_id          text        not null,
  decision         text        not null,
  rationale        text        not null default '',
  tags             text[]      not null default '{}',
  other_tag        text,
  confidence       smallint    check (confidence between 1 and 5),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workshop, participant_code, case_id)
);

create table if not exists public.principles (
  id              uuid             primary key default gen_random_uuid(),
  workshop        text             not null,
  text            text             not null,
  category        text             not null default 'unsorted',
  position        double precision not null default 0,
  status          text             not null default 'proposed'
                  check (status in ('proposed', 'voting', 'ratified', 'parked')),
  version         integer          not null default 1,
  source_case_id  text,
  proposed_by     text,
  created_at      timestamptz      not null default now(),
  updated_at      timestamptz      not null default now()
);

create table if not exists public.votes (
  id               uuid        primary key default gen_random_uuid(),
  workshop         text        not null,
  principle_id     uuid        not null references public.principles (id) on delete cascade,
  version          integer     not null,
  participant_code text        not null,
  vote             text        not null,
  comment          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (principle_id, version, participant_code)
);

-- If the tables already existed from an older version of the app, add any
-- columns they're missing (no-ops otherwise).
alter table public.participants add column if not exists cases      text[]      not null default '{}';
alter table public.participants add column if not exists guest      boolean     not null default false;
alter table public.participants add column if not exists created_at timestamptz not null default now();
alter table public.responses  add column if not exists rationale  text        not null default '';
alter table public.responses  add column if not exists tags       text[]      not null default '{}';
alter table public.responses  add column if not exists other_tag  text;
alter table public.responses  add column if not exists confidence smallint;
alter table public.responses  add column if not exists created_at timestamptz not null default now();
alter table public.responses  add column if not exists updated_at timestamptz not null default now();
alter table public.principles add column if not exists category       text             not null default 'unsorted';
alter table public.principles add column if not exists position       double precision not null default 0;
alter table public.principles add column if not exists status         text             not null default 'proposed';
alter table public.principles add column if not exists version        integer          not null default 1;
alter table public.principles add column if not exists source_case_id text;
alter table public.principles add column if not exists proposed_by    text;
alter table public.principles add column if not exists created_at     timestamptz      not null default now();
alter table public.principles add column if not exists updated_at     timestamptz      not null default now();
alter table public.votes      add column if not exists comment    text;
alter table public.votes      add column if not exists created_at timestamptz not null default now();
alter table public.votes      add column if not exists updated_at timestamptz not null default now();

create index if not exists responses_workshop_idx  on public.responses (workshop);
create index if not exists principles_workshop_idx on public.principles (workshop);
create index if not exists votes_workshop_idx      on public.votes (workshop);

-- Open access for the workshop (no logins).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on public.participants, public.responses, public.principles, public.votes
  to anon, authenticated;

alter table public.participants enable row level security;
alter table public.responses    enable row level security;
alter table public.principles   enable row level security;
alter table public.votes        enable row level security;

drop policy if exists "workshop open access" on public.participants;
drop policy if exists "workshop open access" on public.responses;
drop policy if exists "workshop open access" on public.principles;
drop policy if exists "workshop open access" on public.votes;

create policy "workshop open access" on public.participants for all to anon, authenticated using (true) with check (true);
create policy "workshop open access" on public.responses    for all to anon, authenticated using (true) with check (true);
create policy "workshop open access" on public.principles   for all to anon, authenticated using (true) with check (true);
create policy "workshop open access" on public.votes        for all to anon, authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- AFTER THE WORKSHOP (optional): make the data read-only. Select the lines
-- below (without the leading "-- "), and run them.
--
-- drop policy if exists "workshop open access" on public.participants;
-- drop policy if exists "workshop open access" on public.responses;
-- drop policy if exists "workshop open access" on public.principles;
-- drop policy if exists "workshop open access" on public.votes;
-- create policy "read only" on public.participants for select to anon using (true);
-- create policy "read only" on public.responses    for select to anon using (true);
-- create policy "read only" on public.principles   for select to anon using (true);
-- create policy "read only" on public.votes        for select to anon using (true);
