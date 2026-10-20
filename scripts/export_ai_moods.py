"""Export small text-reference vectors for the on-demand audio-only encoder."""
import json
import torch
from transformers import ClapModel, ClapProcessor
from index_music_ai import ROOT, CACHE, MODEL, REVISION, LABELS

torch.set_num_threads(4)
source = str(CACHE / 'model' / REVISION)
processor = ClapProcessor.from_pretrained(source)
model = ClapModel.from_pretrained(source).eval()
with torch.inference_mode():
    vectors = model.get_text_features(**processor(text=list(LABELS.values()), padding=True, return_tensors='pt'))
    vectors = torch.nn.functional.normalize(vectors, dim=-1)
target = ROOT / 'frontend/server/aiMoodVectors.json'
target.write_text(json.dumps({'model': MODEL, 'revision': REVISION, 'labels': list(LABELS),
    'vectors': [[round(float(v), 8) for v in row] for row in vectors]}, separators=(',', ':')) + '\n')
print('Exported eight model-derived mood references (no audio).')
