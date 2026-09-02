import assert from "node:assert/strict";
import test from "node:test";

const feed = { feed: { results: [{ id: "123", name: "Test song", artistName: "Test artist", artworkUrl100: "https://example.com/100x100bb.jpg" }] } };

test("chart feed retries a timeout and keeps the original chart order", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (calls === 1) throw new DOMException("Timed out", "TimeoutError");
    return Response.json(String(url).includes("/lookup")
      ? { results: [{ trackId: 123, previewUrl: "https://example.com/preview.m4a" }] }
      : feed);
  };
  try {
    const { fetchAppleCharts } = await import("./chartFeed.js?retry-test");
    const data = await fetchAppleCharts("in");
    assert.equal(calls, 3);
    assert.equal(data.tracks[0].chart_rank, 1);
    assert.equal(data.tracks[0].preview_url, "https://example.com/preview.m4a");
    assert.equal(data.tracks[0].catalogued, false);
    await fetchAppleCharts("in");
    assert.equal(calls, 3, "repeat request should use the warm cache");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview lookup failure does not hide a valid chart", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/lookup")) throw new Error("Lookup unavailable");
    return Response.json(feed);
  };
  try {
    const { fetchAppleCharts } = await import("./chartFeed.js?lookup-test");
    const data = await fetchAppleCharts("us");
    assert.equal(data.tracks.length, 1);
    assert.equal(data.tracks[0].title, "Test song");
    assert.equal(data.tracks[0].preview_url, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
