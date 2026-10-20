// Opt-in check of the EXISTING Firebase rules; only touches this run's temporary account.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const config = JSON.parse(await readFile(new URL('../public/firebase-config.json', import.meta.url)));
if (config.projectId !== 'cerum-spark-parth-2026') throw new Error('Unexpected test project');
let account;
async function auth(action, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${config.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `Temporary account ${action}: ${response.status}`);
  return response.json();
}
const base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
let document;
try {
  account = await auth('signUp', { email: `cerum-ai-${randomUUID()}@example.invalid`, password: randomUUID() + 'Aa7!', returnSecureToken: true });
  document = `users/${account.localId}/library/interactions`;
  const headers = { Authorization: `Bearer ${account.idToken}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${base}:commit`, { method: 'POST', headers,
    body: JSON.stringify({ writes: [{ update: { name: `projects/${config.projectId}/databases/(default)/documents/${document}`,
      fields: { entries: { arrayValue: { values: [{ mapValue: { fields: {
        track_id: { stringValue: 'ai-feedback-check' }, event_type: { stringValue: 'disliked' }, value: { doubleValue: -2 },
      } } }] } } } }, updateTransforms: [{ fieldPath: 'updated_at', setToServerValue: 'REQUEST_TIME' }] }] }),
    signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Existing rules accept feedback write: ${response.status}`);
  const saved = await fetch(`${base}/${document}`, { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(saved.status, 200);
  const payload = await saved.json();
  assert.equal(payload.fields.entries.arrayValue.values[0].mapValue.fields.value.doubleValue, -2);
  const denied = await fetch(`${base}/${document}`, { signal: AbortSignal.timeout(15000) });
  assert.equal(denied.status, 403, 'Unauthenticated users cannot read private feedback');
  console.log('PASS: numeric feedback saved and restored under existing Firebase rules; unauthenticated reads denied.');
} finally {
  if (account) {
    if (document) {
      const removed = await fetch(`${base}/${document}`, { method: 'DELETE', headers: { Authorization: `Bearer ${account.idToken}` }, signal: AbortSignal.timeout(15000) });
      assert.ok(removed.ok || removed.status === 404, 'Temporary feedback cleanup');
    }
    await auth('delete', { idToken: account.idToken });
    console.log('Temporary feedback and account removed.');
  }
}
