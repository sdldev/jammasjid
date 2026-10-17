// Local env adapter: replaces Cloudflare bindings (KV DATABASE, Durable
// Object HUB, AUTH_SECRET secret) with file-based and in-memory implementations.
// Used by server.mjs and the Kemenag scheduler.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileJadwalStore } from '../lib/jadwalStore.js'
import { createFileLogoStore } from '../lib/logoStore.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DB_FILE = join(ROOT, 'db', 'database.json')
// Prayer-schedule store: a single file db/jadwal-sholat.json (not per-year dirs)
export const JADWAL_DIR = join(ROOT, 'db')
// Logo store: files in public/img (served by serveStatic)
export const LOGO_IMG_DIR = join(ROOT, 'public', 'img')
export const ENV_FILE = join(ROOT, '.env')

// --- minimal .env loader (KEY=VALUE per line, no extra dependency) -----------
function loadDotEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

// --- local SSE hub (replaces Durable Object DisplayHub) ---------------------
// The interface intentionally mirrors proses.js usage:
//   env.HUB.idFromName('display') ; env.HUB.get(id).notify()
export function createLocalHub() {
  const clients = new Set() // Set<http.ServerResponse>
  return {
    clients,
    add(res) {
      clients.add(res)
      res.on('close', () => clients.delete(res))
    },
    idFromName: (name) => ({ name }),
    get: () => ({
      async notify() {
        for (const res of [...clients]) {
          try {
            res.write('event: db-changed\ndata: 1\n\n')
          } catch {
            clients.delete(res)
          }
        }
      }
    })
  }
}

// --- file-backed KV (single JSON document, same as KV key "database") -------
export function createFileDatabase(path = DB_FILE) {
  return {
    async get(key, _type) {
      if (key !== 'database' || !existsSync(path)) return null
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        return null
      }
    },
    async put(key, value) {
      if (key !== 'database') return
      mkdirSync(dirname(path), { recursive: true })
      // Atomic write: temp file then rename, so the db cannot be corrupted
      // if the process dies mid-write.
      const tmp = `${path}.tmp`
      writeFileSync(tmp, value)
      renameSync(tmp, path)
    }
  }
}

// Build an `env` object with the same shape as Cloudflare bindings, so that
// src/lib/* (db.js, proses.js, render.js) works unchanged.
export function createLocalEnv() {
  loadDotEnv(ENV_FILE)
  const hub = createLocalHub()
  return {
    AUTH_SECRET: process.env.AUTH_SECRET || 'dev-secret-ganti-di-file-env',
    // Password admin awal (login user "admin"). Login ditolak selama masih
    // default admin1234; bisa juga diganti lewat menu admin.
    ADMIN_PASS: process.env.ADMIN_PASS || '',
    DATABASE: createFileDatabase(),
    JADWAL_STORE: createFileJadwalStore(JADWAL_DIR),
    LOGO_STORE: createFileLogoStore(LOGO_IMG_DIR),
    HUB: hub,
    PORT: Number(process.env.PORT) || 11111
  }
}
