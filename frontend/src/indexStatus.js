// Hosted indexing isn't a browser-owned job. Read once, and poll only while
// the backend explicitly reports an active build. Errors stop polling too.
export function watchIndexStatus(read, onStatus, {
  schedule = setTimeout,
  cancel = clearTimeout,
  isVisible = () => typeof document === "undefined" || !document.hidden,
} = {}) {
  let disposed = false;
  let timer;
  async function update() {
    if (disposed) return;
    if (!isVisible()) {
      timer = schedule(update, 10_000);
      return;
    }
    try {
      const response = await read();
      if (disposed) return;
      onStatus(response.data);
      if (response.data.building) timer = schedule(update, 10_000);
    } catch { /* Do not hammer an unavailable service in the background. */ }
  }
  update();
  return () => { disposed = true; cancel(timer); };
}
