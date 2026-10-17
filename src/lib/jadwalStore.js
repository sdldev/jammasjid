// Kemenag official-schedule storage, separate from database.json.
// Single file: db/jadwal-sholat.json — map 'YYYY-MM-DD' →
// {fajr, sunrise, dhuhr, asr, maghrib, isha}, holding a rolling ~3-month
// window (stale dates are dropped on save).
//
// Design rationale: database.json is CONFIGURATION (small, rarely changes,
// often read by humans / backed up), while jadwal_resmi is PERIODIC DATA
// (changes on every daily sync). Keeping them apart leaves the config file
// lean and the db hash stable. Max size (~90 days ≈ 15 KB) makes a single
// file simpler and safer than splitting per year.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const KEY = 'jadwal_resmi'

// Pruning: drop stale dates (< today). The display only reads today and
// tomorrow; past schedules are useless.
export function buangUsang(jadwal) {
  const batas = new Date().toISOString().slice(0, 10)
  const out = {}
  for (const [iso, times] of Object.entries(jadwal)) {
    if (iso >= batas) out[iso] = times
  }
  return out
}

// --- file backend (local mode) ----------------------------------------------

export function createFileJadwalStore(dir, { fileName = 'jadwal-sholat.json' } = {}) {
  const file = join(dir, fileName)
  return {
    async load() {
      if (!existsSync(file)) return {}
      try {
        return JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        // corrupt file: ignore, the next sync will overwrite it
        return {}
      }
    },
    async save(jadwal) {
      mkdirSync(dir, { recursive: true })
      const data = buangUsang(jadwal)
      // Atomic write: temp file then rename, so nothing is corrupted if the
      // process dies mid-write.
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, file)
    }
  }
}

// --- KV backend (Workers mode): a single key --------------------------------

export function createKvJadwalStore(kv) {
  return {
    async load() {
      const data = await kv.get('jadwal-sholat', 'json')
      return data || {}
    },
    async save(jadwal) {
      await kv.put('jadwal-sholat', JSON.stringify(buangUsang(jadwal)))
    }
  }
}

// Pick a store from env: the local adapter provides env.JADWAL_STORE,
// Workers mode falls back to KV (env.DATABASE). Neither → store inactive.
export function storeFromEnv(env) {
  if (env.JADWAL_STORE) return env.JADWAL_STORE
  if (env.DATABASE) return createKvJadwalStore(env.DATABASE)
  return null
}

// One-time migration: a legacy inline jadwal_resmi in the database document
// is moved to the separate store and stripped from the document. Returns true
// when a move happened (the caller should persist the db without the legacy key).
export async function migrateLegacyJadwal(store, storedDb) {
  const legacy = storedDb?.[KEY]
  if (!legacy || !Object.keys(legacy).length) return false
  await store.save(legacy)
  delete storedDb[KEY]
  return true
}

export const JADWAL_KEY = KEY
