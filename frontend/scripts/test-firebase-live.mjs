// Opt-in smoke test of the isolated Spark project. Never uses admin credentials.
// Creates two temporary Auth users, tests real deployed rules, then removes its data/users.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const projectId = 'cerum-spark-parth-2026';
if (process.argv[2] !== '--confirm-project=' + projectId) throw new Error('Explicit isolated-project confirmation required.');
const config = JSON.parse(process.env.CERUM_TEST_FIREBASE_CONFIG || '{}');
assert.equal(config.projectId, projectId, 'Refusing to test a different project');
assert.ok(config.apiKey);
const origin = 'https://firestore.googleapis.com/v1';
const root = `projects/${projectId}/databases/(default)/documents`;
const accounts = [];
let checks = 0;

async function request(url, method = 'GET', body, token) {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const auth = (method, body) => request(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${config.apiKey}`, 'POST', body);
const path = (uid, kind = 'favorites') => `${root}/users/${uid}/library/${kind}`;
const encode = (value) => Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
  : value === null ? { nullValue: null } : typeof value === 'object'
    ? { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } }
    : typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number'
      ? { doubleValue: value } : { stringValue: String(value) };
const read = (name, token) => request(`${origin}/${name}`, 'GET', undefined, token);
const remove = (name, token) => request(`${origin}/${name}`, 'DELETE', undefined, token);
const write = (name, entries, token, extra = {}, timestamp = true) => request(`${origin}/${root}:commit`, 'POST', {
  writes: [{ update: { name, fields: { entries: encode(entries), ...extra } },
    ...(timestamp ? { updateTransforms: [{ fieldPath: 'updated_at', setToServerValue: 'REQUEST_TIME' }] } : {}) }],
}, token);
function allowed(result, label) { assert.ok(result.status >= 200 && result.status < 300, `${label}: ${result.status} ${result.body.error?.message ?? ''}`); checks++; }
function denied(result, label) { assert.equal(result.status, 403, `${label}: expected rules denial, got ${result.status}`); assert.equal(result.body.error?.status, 'PERMISSION_DENIED'); checks++; }

try {
  for (let i = 0; i < 2; i++) {
    const email = `cerum-smoke-${randomUUID()}@example.invalid`;
    const password = randomUUID() + '-Test9!';
    const result = await auth('signUp', { email, password, returnSecureToken: true });
    allowed(result, 'temporary account creation');
    accounts.push({ uid: result.body.localId, token: result.body.idToken, email, password });
  }
  const [alice, bob] = accounts;
  const favorite = path(alice.uid);
  allowed(await write(favorite, [{ track_id: 'smoke-test', title: 'Temporary verification record' }], alice.token), 'owner create');
  const saved = await read(favorite, alice.token);
  allowed(saved, 'owner read');
  assert.equal(saved.body.fields.entries.arrayValue.values[0].mapValue.fields.track_id.stringValue, 'smoke-test');
  assert.ok(saved.body.fields.updated_at.timestampValue, 'server timestamp saved');
  allowed(await write(favorite, [{ track_id: 'smoke-test-updated' }], alice.token), 'owner update');
  for (const token of [bob.token, undefined]) {
    denied(await read(favorite, token), 'cross-account/guest read');
    denied(await write(favorite, [], token), 'cross-account/guest write');
    denied(await remove(favorite, token), 'cross-account/guest delete');
  }
  allowed(await write(favorite, Array(100).fill({ track_id: 'test' }), alice.token), '100 favourites allowed');
  denied(await write(favorite, Array(101).fill({ track_id: 'test' }), alice.token), '101 favourites denied');
  allowed(await write(path(alice.uid, 'history'), Array(30).fill({ mode: 'similar' }), alice.token), '30 history entries allowed');
  denied(await write(path(alice.uid, 'history'), Array(31).fill({ mode: 'similar' }), alice.token), '31 history entries denied');
  allowed(await write(path(alice.uid, 'interactions'), Array(100).fill({ event_type: 'liked' }), alice.token), '100 feedback entries allowed');
  denied(await write(path(alice.uid, 'interactions'), Array(101).fill({ event_type: 'liked' }), alice.token), '101 feedback entries denied');
  denied(await write(favorite, [], alice.token, { admin: encode(true) }), 'extra fields denied');
  denied(await write(favorite, [], alice.token, { updated_at: encode('yesterday') }, false), 'fake timestamp denied');
  denied(await write(path(alice.uid, 'other'), [], alice.token), 'unknown library document denied');
  denied(await write(`${root}/public/smoke-test`, [], alice.token), 'public writes denied');
  denied(await request(`${origin}/${root}/users/${alice.uid}/library`, 'GET', undefined, alice.token), 'collection scans denied');
  const login = await auth('signInWithPassword', { email: alice.email, password: alice.password, returnSecureToken: true });
  allowed(login, 'password sign-in');
  allowed(await read(favorite, login.body.idToken), 'library persists across fresh sign-in');
  allowed(await remove(favorite, alice.token), 'owner delete');
  console.log(`${checks} live Auth/Firestore security checks passed.`);
} finally {
  const cleanupErrors = [];
  for (const account of accounts) {
    let documentsRemoved = true;
    for (const kind of ['favorites', 'history', 'interactions']) {
      try {
        const result = await remove(path(account.uid, kind), account.token);
        if (result.status !== 200 && result.status !== 404) throw new Error(`${kind}: HTTP ${result.status}`);
      } catch (error) { documentsRemoved = false; cleanupErrors.push(`${account.uid}: ${error.message}`); }
    }
    // Keep the temporary account accessible if data cleanup failed, rather than orphaning its records.
    if (documentsRemoved) {
      try { const result = await auth('delete', { idToken: account.token }); if (result.status !== 200) throw new Error(`HTTP ${result.status}`); }
      catch (error) { cleanupErrors.push(`${account.uid}: account cleanup ${error.message}`); }
    }
  }
  if (cleanupErrors.length) throw new Error(`Temporary test cleanup needs attention: ${cleanupErrors.join('; ')}`);
  console.log('Temporary test records and accounts removed.');
}
