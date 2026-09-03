// Selection is a device preference, never an authorization claim. Each provider validates its own session.
export function createSessions(providers, storage) {
  const key = 'cerum-account-provider-v1';
  let selected;
  try { selected = storage?.getItem(key); } catch { /* private browsing */ }
  let epoch = 0;
  let busy = false;
  let restoring;
  const select = (provider) => { selected = provider; epoch++; try { storage?.setItem(key, provider); } catch { /* optional preference */ } };
  const tag = (user, provider) => user ? { ...user, provider, account_key: `${provider}:${user.id}` } : null;
  async function current() {
    if (selected === 'signed-out') return null;
    const started = epoch;
    if (providers[selected]) {
      const provider = selected;
      const user = await providers[provider].current();
      return epoch === started ? tag(user, provider) : null;
    }
    // Preserve an existing Cerum login; do not merge accounts with matching email addresses.
    restoring ??= (async () => {
      for (const provider of ['supabase', 'firebase']) {
        const user = await providers[provider].current().catch(() => null);
        if (epoch !== started) return null;
        if (user) { select(provider); return tag(user, provider); }
      }
      return null;
    })().finally(() => { restoring = null; });
    return restoring;
  }
  async function authenticate(provider, action, args) {
    if (!providers[provider]) throw new Error('Choose Firebase or Supabase.');
    if (busy) throw new Error('A sign-in is already in progress.');
    busy = true;
    select('signed-out');
    const started = epoch;
    try {
      const result = await providers[provider][action](...args);
      if (epoch !== started) throw new Error('Your session changed. Please sign in again.');
      if (result.user) select(provider);
      return { ...result, user: tag(result.user, provider) };
    } finally { busy = false; }
  }
  return {
    current,
    login: (provider, email, password) => authenticate(provider, 'login', [email, password]),
    register: (provider, name, email, password) => authenticate(provider, 'register', [name, email, password]),
    async logout() { select('signed-out'); await Promise.allSettled(Object.values(providers).map((provider) => provider.logout())); },
    async capture() { const user = await current(); return user ? { user, epoch, provider: user.provider, uid: user.id } : null; },
    async assert(snapshot) {
      if (!snapshot || snapshot.epoch !== epoch || snapshot.provider !== selected) throw new Error('Your account changed. Please retry.');
      const user = await providers[snapshot.provider].current();
      if (!user || user.id !== snapshot.uid || snapshot.epoch !== epoch) throw new Error('Your account changed. Please retry.');
    },
  };
}
