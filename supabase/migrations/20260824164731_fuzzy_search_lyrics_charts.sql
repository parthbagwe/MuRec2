create extension if not exists pg_trgm with schema extensions;

create or replace function public.normalize_music_search(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(
    replace(replace(replace(lower(coalesce(value, '')), '''', ''), '’', ''), '`', ''),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$$;

revoke all on function public.normalize_music_search(text) from public;
grant execute on function public.normalize_music_search(text) to anon, authenticated, service_role;

alter table public.tracks
  add column if not exists search_text text
  generated always as (public.normalize_music_search(title || ' ' || artist)) stored;

create index if not exists tracks_search_text_trgm_idx
  on public.tracks using gin (search_text extensions.gin_trgm_ops);

create or replace function public.search_tracks_fuzzy(search_query text, result_limit integer default 80)
returns table (track_id text, search_score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select public.normalize_music_search(search_query) as query
  ), scored as (
    select
      track.track_id,
      (
        case when public.normalize_music_search(track.title) = input.query then 10.0 else 0.0 end +
        case when track.search_text = input.query then 8.0 else 0.0 end +
        case when public.normalize_music_search(track.title) like input.query || '%' then 4.0 else 0.0 end +
        case when track.search_text like '%' || input.query || '%' then 2.0 else 0.0 end +
        3.5 * extensions.similarity(track.search_text, input.query) +
        2.5 * extensions.word_similarity(input.query, track.search_text)
      )::real as search_score
    from public.tracks as track
    cross join input
    where input.query <> '' and (
      track.search_text like '%' || input.query || '%'
      or extensions.similarity(track.search_text, input.query) >= 0.16
      or extensions.word_similarity(input.query, track.search_text) >= 0.28
    )
  )
  select scored.track_id, scored.search_score
  from scored
  order by scored.search_score desc, scored.track_id
  limit least(greatest(result_limit, 1), 200);
$$;

revoke all on function public.search_tracks_fuzzy(text, integer) from public;
grant execute on function public.search_tracks_fuzzy(text, integer) to anon, authenticated, service_role;

create table if not exists public.lyric_features (
  track_id text primary key references public.tracks(track_id) on delete cascade,
  provider text not null,
  provider_track_id text,
  language text,
  instrumental boolean not null default false,
  themes text[] not null default '{}',
  theme_vector jsonb not null default '{}'::jsonb check (jsonb_typeof(theme_vector) = 'object'),
  sentiment real check (sentiment is null or sentiment between -1 and 1),
  arousal real check (arousal is null or arousal between 0 and 1),
  confidence real not null default 0 check (confidence between 0 and 1),
  analyzed_at timestamptz not null default now()
);

create index if not exists lyric_features_language_idx on public.lyric_features (language);
alter table public.lyric_features enable row level security;
revoke all on table public.lyric_features from anon, authenticated;

alter table public.recommendation_runs
  drop constraint if exists recommendation_runs_mode_check;
alter table public.recommendation_runs
  add constraint recommendation_runs_mode_check
  check (mode in ('similar', 'rhythm', 'timbre', 'discover', 'personalized', 'transition'));
