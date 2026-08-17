create index favorites_track_idx on public.favorites (track_id);

create policy "Client roles cannot access fingerprint failures"
on public.fingerprint_failures
for all
to anon, authenticated
using (false)
with check (false);
