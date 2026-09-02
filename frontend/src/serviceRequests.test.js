import test from "node:test";
import assert from "node:assert/strict";
import { createHostedRequests } from "./serviceRequests.js";
import { watchIndexStatus } from "./indexStatus.js";

test("public reads coalesce, expire, and return isolated cached values", async () => {
  let calls = 0;
  let now = 100;
  const edge = createHostedRequests(async () => ({ data: { results: [++calls] } }), { now: () => now });
  const [first, second] = await Promise.all([edge("tracks", { q: "modern" }), edge("tracks", { q: "modern" })]);
  assert.equal(calls, 1);
  first.data.results.push("changed");
  assert.deepEqual(second.data.results, [1]);
  assert.deepEqual((await edge("tracks", { q: "modern" })).data.results, [1]);
  now += 120_000;
  await edge("tracks", { q: "modern" });
  assert.equal(calls, 2);
});

test("private reads, recommendations, and writes never enter shared caches", async () => {
  let calls = 0;
  const edge = createHostedRequests(async () => ({ data: { sequence: ++calls } }));
  for (const action of ["favorites", "history", "recommend", "event", "addFavorite", "clearHistory"]) {
    const first = await edge(action);
    const second = await edge(action);
    assert.notEqual(first.data.sequence, second.data.sequence);
  }
});

test("cache size is bounded and failed requests are retried", async () => {
  let calls = 0;
  const edge = createHostedRequests(async () => {
    calls++;
    return calls === 1 ? { error: new Error("offline") } : { data: calls };
  }, { maxEntries: 2 });
  await assert.rejects(edge("track", { id: 1 }), /offline/);
  for (const id of [1, 2, 3, 1]) await edge("track", { id });
  assert.equal(calls, 5);
});

test("known quota errors explain the outage and briefly stop repeated requests", async () => {
  let now = 1;
  let calls = 0;
  const edge = createHostedRequests(async () => {
    calls++;
    return { error: { context: new Response(JSON.stringify({ message: "Service restricted: exceed_egress_quota" }), { status: 402 }) } };
  }, { now: () => now });
  await assert.rejects(edge("tracks", { q: "modern" }), /hosting bandwidth limit/);
  await assert.rejects(edge("tracks", { q: "duality" }), /hosting bandwidth limit/);
  assert.equal(calls, 1);
  now += 60_000;
  await assert.rejects(edge("tracks"), /hosting bandwidth limit/);
  assert.equal(calls, 2);
});

test("cancellation is passed through and aborted responses are not cached", async () => {
  const controller = new AbortController();
  let calls = 0;
  const edge = createHostedRequests(async (_name, options) => {
    calls++;
    if (calls === 1) {
      assert.strictEqual(options.signal, controller.signal);
      controller.abort();
    }
    return { data: { results: [] } };
  });
  await assert.rejects(edge("tracks", { q: "modern" }, { signal: controller.signal }), { name: "AbortError" });
  await edge("tracks", { q: "modern" });
  assert.equal(calls, 2);
});

test("active build status is not cached", async () => {
  let calls = 0;
  const edge = createHostedRequests(async () => ({ data: { building: true, indexed: ++calls } }));
  await edge("acousticStatus");
  await edge("acousticStatus");
  assert.equal(calls, 2);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
test("index watcher polls only active builds and stops on completion or error", async () => {
  const scheduled = [];
  let calls = 0;
  const values = [];
  const stop = watchIndexStatus(async () => ({ data: { building: ++calls === 1 } }), (value) => values.push(value), {
    schedule: (fn) => { scheduled.push(fn); return scheduled.length; }, cancel: () => {},
  });
  await flush();
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  assert.equal(scheduled.length, 0);
  assert.deepEqual(values, [{ building: true }, { building: false }]);
  stop();
  watchIndexStatus(async () => { throw new Error("quota"); }, () => assert.fail("no status"), {
    schedule: () => assert.fail("must not retry an outage"), cancel: () => {},
  });
  await flush();
});

test("hidden tabs make no polling requests and disposal suppresses late responses", async () => {
  let scheduled;
  let calls = 0;
  const stop = watchIndexStatus(async () => { calls++; return { data: { building: false } }; }, () => assert.fail("disposed"), {
    isVisible: () => false, schedule: (fn) => { scheduled = fn; return 1; }, cancel: () => {},
  });
  assert.equal(calls, 0);
  stop();
  await scheduled();
  assert.equal(calls, 0);

  let resolve;
  const dispose = watchIndexStatus(() => new Promise((done) => { resolve = done; }), () => assert.fail("late response"));
  dispose();
  resolve({ data: { building: true } });
  await flush();
});
