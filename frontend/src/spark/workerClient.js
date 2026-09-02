let worker;
let nextId = 0;
const pending = new Map();

export function musicRequest(action, input = {}, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Search cancelled", "AbortError"));
  if (!worker) {
    worker = new Worker(new URL("./catalogue.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.data);
    };
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error("Music analysis stopped. Please retry."));
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const finish = (callback) => (value) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); pending.delete(id); callback(value); };
    const abort = () => pending.get(id)?.reject(new DOMException("Search cancelled", "AbortError"));
    const timer = setTimeout(() => pending.get(id)?.reject(new Error("The first catalogue download is taking too long. Please retry on a stable connection.")), 90_000);
    pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
    signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage({ id, action, input });
  });
}
