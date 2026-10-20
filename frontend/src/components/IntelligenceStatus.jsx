import { useEffect, useState } from 'react';

export default function IntelligenceStatus({ result, live }) {
  const [index, setIndex] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/intelligence/manifest.json', { signal: controller.signal })
      .then((r) => r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null)
      .then((data) => { if (!controller.signal.aborted && Number.isInteger(data?.indexed)) setIndex(data); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!index) return null;
  return <aside className="intelligence-status" aria-label="AI recommendation coverage">
    <div><span className="intelligence-dot" aria-hidden="true" /><strong>AI sound matching</strong><span className="intelligence-stage">Early access</span></div>
    <p>{result ? result.method === 'acoustic-bridge'
      ? 'This sound bridge uses acoustic transition scoring to keep your destination intact.'
      : result.indexed === 0
      ? 'The AI index could not load this time. Your suggestions are using acoustic matching.'
      : result.anchor_indexed
      ? `Your preview is AI-indexed. ${result.matched} of these suggestions use learned sound and predicted mood alongside acoustic matching.${result.candidate_pool === 'learned-with-acoustic-fallback' ? ' Comparing against the analysed preview library; acoustic matches fill any gaps.' : ''}`
      : 'This preview currently uses acoustic matching. On-demand AI can refine its suggestions when analysis is available.'
      : 'Matching how the preview sounds, with feedback that tunes your next suggestions.'}</p>
    {live && <p className="live-ai-status" role="status" data-state={live.state}>{live.message}</p>}
    <small>{index.indexed.toLocaleString()} / {index.total.toLocaleString()} catalogue previews pre-indexed · other searched previews analysed on demand · up to 30 seconds sent to Cerum’s AI service; no audio stored</small>
  </aside>;
}
