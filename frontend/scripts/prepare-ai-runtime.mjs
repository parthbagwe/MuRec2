// Build-time download: weights stay inside the server function, never public/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ONNX_MODEL, ONNX_REVISION, ONNX_SHA256 } from '../server/aiConfig.js';
const dir = new URL('../server/models/clap/', import.meta.url);
await mkdir(new URL('onnx/', dir), { recursive: true });
for (const name of ['config.json', 'preprocessor_config.json', 'onnx/audio_model_quantized.onnx']) {
  const target = new URL(name, dir);
  const valid = (bytes) => name.endsWith('.onnx')
    ? createHash('sha256').update(bytes).digest('hex') === ONNX_SHA256
    : Boolean(JSON.parse(bytes.toString()));
  try { if (valid(await readFile(target))) continue; } catch { /* download below */ }
  const response = await fetch(`https://huggingface.co/${ONNX_MODEL}/resolve/${ONNX_REVISION}/${name}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`AI runtime download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('AI checkpoint checksum mismatch');
  await writeFile(target, bytes);
  console.log(`Prepared server-only ${name} (${bytes.length} bytes)`);
}
await writeFile(new URL('LICENSE', dir), await readFile(new URL('../node_modules/@huggingface/transformers/LICENSE', import.meta.url)));
await writeFile(new URL('NOTICE', dir), `CLAP audio model: LAION-AI, https://huggingface.co/laion/clap-htsat-unfused\nONNX conversion: Xenova, https://huggingface.co/${ONNX_MODEL}/tree/${ONNX_REVISION}\nApache License 2.0. Model copyright remains with its respective authors.\n`);
