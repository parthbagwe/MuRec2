create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  personalization_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tracks (
  track_id text primary key, title text not null, artist text not null, album text,
  provider_genre text, seed_genre text, year integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  artwork_url text, external_url text, source text not null default 'Catalogue',
  preview_url text, provider_subgenre text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.acoustic_fingerprints (
  track_id text primary key references public.tracks(track_id) on delete cascade,
  vector jsonb not null check (jsonb_typeof(vector) = 'array'),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  acoustic_signature text not null, analyzed_at timestamptz not null default now()
);

create table public.fingerprint_failures (
  track_id text primary key references public.tracks(track_id) on delete cascade,
  attempts integer not null default 1 check (attempts > 0),
  last_error text not null, updated_at timestamptz not null default now()
);

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_id text not null references public.tracks(track_id) on delete cascade,
  title text not null, artist text not null, subgenre text, artwork_url text,
  preview_url text, external_url text, created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create table public.recommendation_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  anchor_track_id text not null, anchor_title text not null, anchor_artist text not null,
  mode text not null check (mode in ('similar', 'rhythm', 'timbre', 'discover', 'personalized')),
  weights jsonb not null check (jsonb_typeof(weights) = 'object'),
  created_at timestamptz not null default now()
);

create table public.recommendation_items (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.recommendation_runs(id) on delete cascade,
  track_id text not null, title text not null, artist text not null, subgenre text,
  rank integer not null check (rank > 0), score double precision not null check (score between 0 and 1)
);

create table public.interactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_id text not null,
  event_type text not null check (event_type in ('selected', 'preview_started', 'preview_completed', 'youtube_opened', 'liked', 'disliked', 'dismissed')),
  value double precision, created_at timestamptz not null default now()
);

create index favorites_user_created_idx on public.favorites (user_id, created_at desc);
create index recommendation_runs_user_created_idx on public.recommendation_runs (user_id, created_at desc);
create index recommendation_items_run_rank_idx on public.recommendation_items (run_id, rank);
create index recommendation_items_track_idx on public.recommendation_items (track_id);
create index interactions_user_created_idx on public.interactions (user_id, created_at desc);
create index interactions_user_track_idx on public.interactions (user_id, track_id);

alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.acoustic_fingerprints enable row level security;
alter table public.fingerprint_failures enable row level security;
alter table public.favorites enable row level security;
alter table public.recommendation_runs enable row level security;
alter table public.recommendation_items enable row level security;
alter table public.interactions enable row level security;

revoke all on table public.profiles, public.tracks, public.acoustic_fingerprints,
  public.fingerprint_failures, public.favorites, public.recommendation_runs,
  public.recommendation_items, public.interactions from anon, authenticated;
revoke all on sequence public.recommendation_runs_id_seq,
  public.recommendation_items_id_seq, public.interactions_id_seq from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.tracks, public.acoustic_fingerprints to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.favorites to authenticated;
grant select, insert, delete on public.recommendation_runs, public.recommendation_items,
  public.interactions to authenticated;
grant usage, select on sequence public.recommendation_runs_id_seq,
  public.recommendation_items_id_seq, public.interactions_id_seq to authenticated;

create policy "Public can read tracks" on public.tracks for select to anon, authenticated using (true);
create policy "Public can read acoustic fingerprints" on public.acoustic_fingerprints for select to anon, authenticated using (true);
create policy "Users can read their profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users can create their profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users can update their profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Users can read their favorites" on public.favorites for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their favorites" on public.favorites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their favorites" on public.favorites for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can remove their favorites" on public.favorites for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their recommendation runs" on public.recommendation_runs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their recommendation runs" on public.recommendation_runs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can remove their recommendation runs" on public.recommendation_runs for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their recommendation items" on public.recommendation_items for select to authenticated
using (exists (select 1 from public.recommendation_runs run where run.id = recommendation_items.run_id and run.user_id = (select auth.uid())));
create policy "Users can create their recommendation items" on public.recommendation_items for insert to authenticated
with check (exists (select 1 from public.recommendation_runs run where run.id = recommendation_items.run_id and run.user_id = (select auth.uid())));
create policy "Users can remove their recommendation items" on public.recommendation_items for delete to authenticated
using (exists (select 1 from public.recommendation_runs run where run.id = recommendation_items.run_id and run.user_id = (select auth.uid())));

create policy "Users can read their interactions" on public.interactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their interactions" on public.interactions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can remove their interactions" on public.interactions for delete to authenticated using ((select auth.uid()) = user_id);
