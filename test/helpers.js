// Minimal in-memory KV + hub stub for unit tests
// ADMIN_PASS: password admin non-default agar login diizinkan di test
// (login ditolak selama masih password default admin1234).
export function makeEnv({ secret = 'test-secret', hub = makeHubStub(), adminPass = 'test-admin-pass' } = {}) {
  const store = new Map()
  return {
    AUTH_SECRET: secret,
    ADMIN_PASS: adminPass,
    DATABASE: {
      async get(key, _type) {
        const raw = store.get(key)
        return raw ? JSON.parse(raw) : null
      },
      async put(key, value) {
        store.set(key, value)
      },
      async delete(key) {
        store.delete(key)
      },
      _store: store
    },
    HUB: hub
  }
}

export function makeHubStub() {
  const calls = []
  return {
    calls,
    idFromName: (name) => ({ name }),
    get: () => ({
      async notify() {
        calls.push('notify')
      }
    })
  }
}
