"""Optional resumable download for networks that stall on a single large HF transfer."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import requests

MODEL = 'laion/clap-htsat-unfused'
REVISION = '8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a'
SHA256 = '1cd3c601bc4afe0fa87be3de4c13dd2cfadd249fac1e29acf74a9b296c3219bb'
SIZE = 614525833
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '.cache/music-ai/model' / REVISION
URL = f'https://huggingface.co/{MODEL}/resolve/{REVISION}/pytorch_model.bin'


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for name in ['config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
                 'special_tokens_map.json', 'vocab.json', 'merges.txt', 'README.md']:
        path = DEST / name
        if not path.exists():
            response = requests.get(URL.rsplit('/', 1)[0] + '/' + name, timeout=30)
            response.raise_for_status()
            path.write_bytes(response.content)
    chunk = 8 * 1024 * 1024

    def download(start):
        end = min(SIZE - 1, start + chunk - 1)
        path = DEST / f'{start}.part'
        if path.exists() and path.stat().st_size == end - start + 1:
            return path
        for attempt in range(3):
            try:
                response = requests.get(URL + f'?part={start}', headers={'Range': f'bytes={start}-{end}'}, timeout=(10, 45))
                response.raise_for_status()
                if response.status_code != 206 or len(response.content) != end - start + 1:
                    raise RuntimeError('Server did not honour the bounded range request')
                path.write_bytes(response.content)
                print(f'Downloaded {end + 1} / {SIZE}', flush=True)
                return path
            except Exception:
                if attempt == 2:
                    raise
    with ThreadPoolExecutor(max_workers=6) as pool:
        paths = list(pool.map(download, range(0, SIZE, chunk)))
    target = DEST / 'pytorch_model.bin'
    digest = hashlib.sha256()
    with target.open('wb') as stream:
        for path in paths:
            content = path.read_bytes()
            digest.update(content)
            stream.write(content)
    if digest.hexdigest() != SHA256:
        target.unlink()
        raise RuntimeError('Checkpoint digest mismatch')
    for path in paths:
        path.unlink()
    print(f'Verified checkpoint: {target}', flush=True)


if __name__ == '__main__':
    main()
