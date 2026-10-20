"""Sanity-check the installed inference runtime, not a recommendation-quality benchmark."""
import json
from pathlib import Path
import torch
from transformers import ClapModel, ClapProcessor
torch.set_num_threads(4)
source = Path(__file__).resolve().parents[1] / '.cache/music-ai/model/8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a'
processor = ClapProcessor.from_pretrained(str(source))
texts = ['A dog barking loudly.', 'A piano playing a sad melody.', 'Electronic dance music with a fast beat.',
         'Heavy metal music with distorted electric guitars.']
for attention in ['eager']:
    try:
        model = ClapModel.from_pretrained(str(source), attn_implementation=attention).eval()
        inputs = processor(text=texts, padding=True, return_tensors='pt')
        with torch.inference_mode():
            vectors = model.get_text_features(**inputs)
            vectors = torch.nn.functional.normalize(vectors, dim=-1)
        print(json.dumps({'attention': attention, 'token_ids': inputs['input_ids'].tolist(),
                          'text_cosine': (vectors @ vectors.T).tolist(),
                          'vector_std': vectors.std().item()}), flush=True)
        del model
    except Exception as error:
        print(attention, str(error), flush=True)
