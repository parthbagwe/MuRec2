import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessions } from './session.js';
import { createMusicRouter } from './musicRouter.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(selected) {
  const users = { firebase: null, supabase: null };
  const calls = [];
  const providers = Object.fromEntries(Object.keys(users).map((name) => [name, {
    current: async () => users[name],
    login: async (...args) => { calls.push([name, 'login', ...args]); users[name] = { id: name + '-id' }; return { user: users[name] }; },
    register: async (...args) => { calls.push([name, 'register', ...args]); users[name] = { id: name + '-id' }; return { user: users[name] }; },
    logout: async () => { users[name] = null; },
  }]));
  const storage = { getItem: () => selected, setItem: (_, value) => { selected = value; } };
  return { users, providers, calls, sessions: createSessions(providers, storage), storage };
}
test('new visitors have no account and no private data', async () => {
  assert.equal(await setup().sessions.current(), null);
});
test('existing Supabase login survives first dual visit', async () => {
  const s = setup(); s.users.supabase = { id: 'old' }; s.users.firebase = { id: 'new' };
  assert.equal((await s.sessions.current()).account_key, 'supabase:old');
});
test('concurrent restoration is coalesced and preserves valid snapshot', async () => {
  const s = setup(); const wait = deferred(); s.providers.supabase.current = () => wait.promise;
  const a = s.sessions.capture(), b = s.sessions.capture(); wait.resolve({ id: 'old' });
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.epoch, second.epoch); await s.sessions.assert(first);
});
test('selected Firebase account stays Firebase even if Supabase is available', async () => {
  const s = setup('firebase'); s.users.firebase = { id: 'new' }; s.users.supabase = { id: 'old' };
  assert.equal((await s.sessions.current()).provider, 'firebase');
});
test('password goes only to explicitly selected provider', async () => {
  const s = setup(); await s.sessions.login('firebase', 'test@example.invalid', 'test-password');
  assert.deepEqual(s.calls, [['firebase', 'login', 'test@example.invalid', 'test-password']]);
  assert.equal((await s.sessions.current()).account_key, 'firebase:firebase-id');
});
test('registration forwards name and credentials to one provider only', async () => {
  const s = setup(); await s.sessions.register('supabase', 'Listener', 'test@example.invalid', 'test-password');
  assert.deepEqual(s.calls, [['supabase', 'register', 'Listener', 'test@example.invalid', 'test-password']]);
});
test('failed login never falls back with the same password', async () => {
  const s = setup(); s.providers.supabase.login = async () => { throw new Error('quota'); };
  await assert.rejects(s.sessions.login('supabase', 'test@example.invalid', 'test-password'), /quota/);
  assert.deepEqual(s.calls, []); assert.equal(await s.sessions.current(), null);
});
test('provider switch invalidates pending private reads/writes even with matching IDs', async () => {
  const s = setup('supabase'); s.users.supabase = { id: 'firebase-id' };
  const old = await s.sessions.capture(); await s.sessions.login('firebase', 'a', 'b');
  await assert.rejects(s.sessions.assert(old), /account changed/);
});
test('SDK user change invalidates snapshots even without a provider switch', async () => {
  const s = setup('firebase'); s.users.firebase = { id: 'first' }; const old = await s.sessions.capture();
  s.users.firebase = { id: 'second' }; await assert.rejects(s.sessions.assert(old), /account changed/);
});
test('logout during restoration does not resurrect a stale account', async () => {
  const s = setup(); const wait = deferred(); s.providers.supabase.current = () => wait.promise;
  const pending = s.sessions.current(); await s.sessions.logout(); wait.resolve({ id: 'old' });
  assert.equal(await pending, null); assert.equal(await s.sessions.current(), null);
});
test('selected session read cannot return a wrongly tagged user after switch', async () => {
  const s = setup('supabase'); const wait = deferred(); s.providers.supabase.current = () => wait.promise;
  const pending = s.sessions.current(); await s.sessions.login('firebase', 'a', 'b'); wait.resolve({ id: 'old' });
  assert.equal(await pending, null);
});
test('logout cancels a pending sign-in without selecting its account', async () => {
  const s = setup(); const wait = deferred(); s.providers.firebase.login = () => wait.promise;
  const pending = s.sessions.login('firebase', 'a', 'b'); await s.sessions.logout(); wait.resolve({ user: { id: 'new' } });
  await assert.rejects(pending, /session changed/); assert.equal(await s.sessions.current(), null);
});
test('Firebase primary never calls Supabase public music', async () => {
  let calls = 0; const route = createMusicRouter({ primary: 'firebase', remote: () => { calls++; } });
  assert.equal(await route('tracks', {}, () => 'browser'), 'browser'); assert.equal(calls, 0);
});
test('Supabase primary prefers healthy remote without calling fallback', async () => {
  const route = createMusicRouter({ primary: 'supabase', remote: async () => 'supabase' });
  assert.equal(await route('tracks', {}, () => { throw new Error('unexpected'); }), 'supabase');
});
test('quota failure falls back and suppresses repeated calls for five minutes', async () => {
  let calls = 0, now = 1; const route = createMusicRouter({ primary: 'supabase', now: () => now, remote: async () => {
    calls++; if (calls === 1) throw Object.assign(new Error('quota'), { status: 402 }); return 'recovered';
  } });
  assert.equal(await route('tracks', {}, () => 'local'), 'local');
  now = 299999; assert.equal(await route('recommend', {}, () => 'mix'), 'mix'); assert.equal(calls, 1);
  now = 300002; assert.equal(await route('tracks', {}, () => 'local'), 'recovered');
});
test('network timeout falls back; user cancellation does not initiate another search', async () => {
  const route = createMusicRouter({ primary: 'supabase', remote: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  assert.equal(await route('tracks', {}, () => 'local'), 'local');
  await assert.rejects(route('tracks', {}, () => { throw new Error('unexpected'); }, { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
test('explicit cancellation during remote call does not trigger fallback', async () => {
  const controller = new AbortController(); const route = createMusicRouter({ primary: 'supabase', remote: async () => {
    controller.abort(); throw new DOMException('cancelled', 'AbortError');
  } });
  await assert.rejects(route('tracks', {}, () => { throw new Error('unexpected'); }, { signal: controller.signal }), { name: 'AbortError' });
});
