"""Download a permitted preview, writing ignored PCM for cross-runtime verification."""
import gzip
import json
import numpy as np
from index_music_ai import ROOT, catalogue, load_preview

data = catalogue()
manifest = json.loads((ROOT / 'frontend/public/intelligence/manifest.json').read_text())
index = json.loads(gzip.decompress((ROOT / 'frontend/public' / manifest['file'].lstrip('/')).read_bytes()))
folder = ROOT / '.cache/on-demand-test'
folder.mkdir(parents=True, exist_ok=True)
indexed = {r['track_id']: r for r in index['tracks']}
fixtures = []
for query in ['blinding lights', 'duality', 'kesariya', 'nenjukkul peidhidum', 'one love', 'tum se hi']:
    track = next((t for t in data['tracks'] if t['title'].lower() == query and t['track_id'] in indexed), None)
    if not track:
        continue
    audio = load_preview(track)
    name = f"{len(fixtures)}.pcm"
    (folder / name).write_bytes(np.clip(audio * 32768, -32768, 32767).astype('<i2').tobytes())
    fixtures.append({'track': track, 'row': indexed[track['track_id']], 'file': name})
    print(track['title'], track['artist'], 'samples:', len(audio), flush=True)
(folder / 'fixtures.json').write_text(json.dumps(fixtures))
