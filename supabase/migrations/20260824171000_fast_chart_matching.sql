create or replace function public.match_chart_tracks(chart_items jsonb)
returns table (chart_id text, track_row jsonb, fingerprint_row jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    item.value ->> 'id' as chart_id,
    matched.track_row,
    matched.fingerprint_row
  from jsonb_array_elements(chart_items) with ordinality as item(value, position)
  join lateral (
    select
      to_jsonb(track) - 'search_text' as track_row,
      to_jsonb(fingerprint) as fingerprint_row
    from public.tracks as track
    join public.acoustic_fingerprints as fingerprint on fingerprint.track_id = track.track_id
    where public.normalize_music_search(track.title) = public.normalize_music_search(item.value ->> 'title')
      and (
        public.normalize_music_search(track.artist) = public.normalize_music_search(item.value ->> 'artist')
        or public.normalize_music_search(track.artist) like '%' || public.normalize_music_search(item.value ->> 'artist') || '%'
        or public.normalize_music_search(item.value ->> 'artist') like '%' || public.normalize_music_search(track.artist) || '%'
      )
    order by
      (public.normalize_music_search(track.artist) = public.normalize_music_search(item.value ->> 'artist')) desc,
      track.track_id
    limit 1
  ) as matched on true
  order by item.position;
$$;

revoke all on function public.match_chart_tracks(jsonb) from public, anon, authenticated;
grant execute on function public.match_chart_tracks(jsonb) to service_role;
