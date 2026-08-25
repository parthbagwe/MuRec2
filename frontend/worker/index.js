export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/preview-analysis") {
      const source = requestUrl.searchParams.get("source");
      if (!source) return new Response("Missing preview source.", { status: 400 });
      let previewUrl;
      try {
        previewUrl = new URL(source);
      } catch {
        return new Response("Invalid preview source.", { status: 400 });
      }
      if (previewUrl.protocol !== "https:" || previewUrl.hostname !== "audio-ssl.itunes.apple.com") {
        return new Response("Preview source is not allowed.", { status: 403 });
      }
      const upstream = await fetch(previewUrl, {
        headers: { Accept: "audio/*" },
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      if (!upstream.ok) return new Response("Preview source did not answer.", { status: upstream.status });
      const contentLength = Number(upstream.headers.get("content-length") || 0);
      if (contentLength > 4_000_000) return new Response("Preview is too large to analyze.", { status: 413 });
      const responseHeaders = new Headers({
        "Content-Type": upstream.headers.get("content-type") || "audio/mp4",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-Content-Type-Options": "nosniff",
      });
      if (contentLength) responseHeaders.set("Content-Length", String(contentLength));
      return new Response(upstream.body, {
        headers: responseHeaders,
      });
    }
    return new Response(null, { status: 404 });
  },
};
