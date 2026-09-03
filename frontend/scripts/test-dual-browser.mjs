// Opt-in end-to-end check. Uses a temporary Firebase account and deletes only its own data.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const url = process.argv[2];
if (!['http://127.0.0.1:5175', 'https://cerum.vercel.app'].includes(url)) throw new Error('Specify the local dual preview or main Cerum URL.');
const cli = process.env.CERUM_AGENT_BROWSER_CLI;
if (!cli) throw new Error('Set CERUM_AGENT_BROWSER_CLI to the installed agent-browser CLI entry.');
const session = process.env.CERUM_BROWSER_SESSION || 'cerum-auth-check';
function browser(...args) {
  try { return execFileSync(process.execPath, [cli, '--session', session, ...args], { encoding: 'utf8', timeout: 55_000, windowsHide: true }); }
  catch { throw new Error(`Browser check failed during ${args[0]} (credentials omitted).`); }
}
function ref(role, name, last = false) {
  const snapshot = browser('snapshot', '-i');
  const rows = snapshot.split('\n').filter((line) => line.includes(`- ${role} "`) && name.test(line));
  assert.ok(rows.length, `Missing UI element: ${role} ${name}`);
  const line = last ? rows.at(-1) : rows[0];
  return '@' + line.match(/ref=(e\d+)/)[1];
}
const click = (name, last = false) => browser('click', ref('button', name, last));
const fill = (name, value) => browser('fill', ref('textbox', name), value);
const config = await (await fetch(`${url}/firebase-config.json`)).json();
assert.equal(config.projectId, 'cerum-spark-parth-2026');
const email = `cerum-ui-${randomUUID()}@example.invalid`;
const password = randomUUID() + 'Aa7!';
let account;
async function auth(action, body) {
  const result = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${config.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error(`Temporary account ${action} failed (${result.status}).`);
  return result.json();
}
try {
  account = await auth('signUp', { email, password, returnSecureToken: true });
  browser('open', url);
  click(/"Log in"/);
  const modal = browser('snapshot', '-i');
  assert.match(modal, /FIREBASE ACCOUNT/); assert.match(modal, /ORIGINAL ACCOUNT · SUPABASE/);
  if (process.argv.includes('--registration-only')) {
    click(/"CREATE ACCOUNT"/);
    browser('fill', '.auth-panel input[autocomplete="name"]', 'Cerum verification');
    browser('fill', '.auth-panel input[type="email"]', email);
    browser('fill', '.auth-panel input[type="password"]', password);
    browser('press', 'Enter');
    browser('wait', '.form-error');
    const message = browser('get', 'text', '.form-error');
    console.log('Registration response:', message.trim());
    assert.match(message, /This Firebase account already exists/);
  } else {
  fill(/"EMAIL"/, email); fill(/"PASSWORD"/, password);
  // The action tab and submit control share a label; target the observed form explicitly.
  browser('click', '.auth-panel form button[type="submit"]');
  try { browser('wait', '.account-name'); }
  catch (error) {
    console.error('Sign-in UI error:', browser('eval', 'document.querySelector(".form-error")?.textContent || "No form error"'));
    console.error('Browser errors:', browser('errors'));
    throw error;
  }
  assert.match(browser('get', 'text', '.account-name'), /Listener · Firebase/);
  account = await auth('signInWithPassword', { email, password, returnSecureToken: true });
  console.log('PASS: both account options; Firebase sign-in and profile render.');

  fill(/"Search songs"/, 'modern jam by travis scott');
  browser('wait', '--text', 'MODERN JAM');
  click(/"MODERN JAM .*Travis Scott.*30s"/);
  click(/02 NEARBY STYLES/);
  browser('wait', '--text', '12 songs that fit');
  browser('wait', '.heightmap-up-next li:nth-child(6)');
  const controls = browser('snapshot', '-i');
  assert.match(controls, /Pause AutoMix/);
  browser('click', '.fullscreen-visualizer .heightmap-play');
  click(/Close full-screen visuals/);
  browser('wait', '--fn', '!document.querySelector(".fullscreen-visualizer")');
  click(/"Add .* to favourites"/);
  browser('wait', '--text', 'Library 1');
  console.log('PASS: search, playback, recommendations, and favourite save.');

  browser('reload'); browser('wait', '.account-name'); browser('wait', '--text', 'Library 1');
  click(/"Library 1"/);
  assert.match(browser('snapshot', '-i'), /Remove .* from favourites/);
  click(/"History /i);
  assert.match(browser('get', 'text', 'body'), /MODERN JAM/);
  console.log('PASS: same Firebase session, favourites, and recommendation history survive reload.');
  click(/Close library/); click(/"Sign out"/);
  browser('wait', '--text', 'Log in');
  assert.doesNotMatch(browser('snapshot', '-i'), /Library 1/);
  console.log('PASS: sign-out removes private library from view.');
  }
  const errors = browser('errors');
  assert.equal(errors.trim(), '', 'No uncaught browser errors');
} finally {
  // If UI creation succeeded just before a test failed, recover only this run's random account for cleanup.
  if (!account) account = await auth('signInWithPassword', { email, password, returnSecureToken: true }).catch(() => null);
  if (account) {
    for (const kind of ['favorites', 'history', 'interactions']) {
      const result = await fetch(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/users/${account.localId}/library/${kind}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${account.idToken}` }, signal: AbortSignal.timeout(15000),
      });
      assert.ok(result.ok || result.status === 404, 'Temporary library cleanup');
    }
    await auth('delete', { idToken: account.idToken });
    console.log('Temporary test account and its library removed.');
  }
  browser('close');
}
