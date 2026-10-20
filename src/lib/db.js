// Database layer: a single JSON document (KV key "database" / file db/database.json).
// Falls back to DEFAULT_DB (ported 1:1 from proses.php getDatabase defaults).
// Note: `jadwal_resmi` is NOT stored in this document — it is rolling data
// that changes on every sync, kept separately (see jadwalStore.js) and
// attached transparently by getDb/putDb.

import { storeFromEnv, migrateLegacyJadwal } from './jadwalStore.js'

const DB_KEY = 'database'

// Default admin password untuk instalasi baru. WAJIB diganti lewat menu admin;
// login ditolak selama password masih default (lihat proses.js, mustChangePass).
export const DEFAULT_ADMIN_PASS = 'admin1234'
export const DEFAULT_ADMIN_USER = 'admin'

export const DEFAULT_DB = {
  // Password TIDAK disimpan di dokumen ini. Sumbernya env.ADMIN_PASS
  // (mode lokal: ADMIN_PASS di .env; Workers: secret ADMIN_PASS).
  akses: { user: DEFAULT_ADMIN_USER, pass: '' },
  setting: {
    nama: 'Musholla Ad-Din',
    lokasi: 'Bekasi',
    latitude: -6.14,
    longitude: 106.59,
    timeZone: 7,
    dst: '0'
  },
  prayTimesMethod: '0',
  prayTimesAdjust: { fajr: 20, dhuhr: '', asr: 'Standard', maghrib: '', isha: 18 },
  prayTimesTune: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  prayName: { fajr: 'Subuh', sunrise: 'Shuruq', dhuhr: 'Dzuhur', asr: 'Ashar', maghrib: 'Maghrib', isha: "Isya'" },
  timeName: { Hours: 'Jam', Minutes: 'Menit', Seconds: 'Detik' },
  dayName: {
    Sunday: 'Ahad', Monday: 'Senin', Tuesday: 'Selasa', Wednesday: 'Rabu',
    Thursday: 'Kamis', Friday: "Jum'at", Saturday: 'Sabtu'
  },
  monthName: {
    January: 'Januari', February: 'Februari', March: 'Maret', April: 'April',
    May: 'Mei', June: 'Juni', July: 'Juli', August: 'Agustus',
    September: 'September', October: 'Oktober', November: 'November', December: 'Desember'
  },
  timer: { wait_adzan: 1, adzan: 3 },
  iqomah: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 },
  // Kemenag official schedule sync (bimasislam.kemenag.go.id) when online.
  // provid/kabkotid = region hash IDs from the Kemenag site (picked in admin UI).
  kemenag: { active: false, provid: '', kabkotid: '', last_sync: '' },
  // Real clock offset (ms) measured from the Kemenag HTTP Date header, used by
  // Tailscale remote access: daftar email pengurus (admin tambahan) yang boleh
  // membuka /admin lewat tailnet. Disimpan di sini agar bisa dikelola dari
  // panel admin; diterapkan ke ACL tailnet oleh scripts/tailscale-acl.sh.
  tailscale: { pengurus_emails: [] },
  // RTC-less STB devices: the display shifts all clock reads by this amount.
  // 0 means the local clock is already accurate.
  time_offset_ms: 0,
  // Official schedule from sync is stored SEPARATELY (jadwalStore.js) and
  // attached to this document transparently by getDb.
  jadwal_resmi: {},
  // Logo opsional kiri/kanan judul nama masjid: URL final (dengan ?v= cache-bust).
  // Kosong = sisi itu tanpa logo. Key baru top-level → shallow-merge DEFAULT_DB
  // otomatis menyediakannya untuk db lama. `position` menentukan penempatan:
  // 'beside_name' (default, kiri/kanan nama masjid) atau 'above_clock'
  // (satu logo di atas jam; kiri diprioritaskan, kanan jika kiri kosong).
  logo: { left: '', right: '', position: 'beside_name' },
  kas: { active: true, rekening: '', kas_bulan_lalu: 0, pendapatan: 0, pengeluaran: 0 },
  running_text: [
    'Selamat datang di aplikasi Display-Masjid',
    'Silakan masuk ke menu admin untuk mengubah data'
  ]
}

export async function getDb(env) {
  let db
  if (env.DATABASE) {
    const stored = await env.DATABASE.get(DB_KEY, 'json')
    if (stored) {
      // Shallow-merge with DEFAULT_DB so new keys (kemenag, etc.) are always
      // present even when the stored db predates them.
      db = { ...structuredClone(DEFAULT_DB), ...stored }
      // `kemenag` gets a dedicated merge: old dbs may only have some fields.
      db.kemenag = { ...DEFAULT_DB.kemenag, ...(stored.kemenag || {}) }
    }
  }
  // structuredClone so handlers never mutate the DEFAULT_DB constant
  db = db || structuredClone(DEFAULT_DB)

  // Attach the official schedule from its separate store (db/jadwal-sholat.json
  // locally / KV key jadwal-sholat on Workers). Legacy migration: if the
  // document still carries an inline jadwal_resmi, move it to the store and
  // strip it from the document.
  const store = storeFromEnv(env)
  if (store) {
    const storedRaw = env.DATABASE ? await env.DATABASE.get(DB_KEY, 'json') : null
    if (storedRaw && (await migrateLegacyJadwal(store, storedRaw))) {
      await env.DATABASE.put(DB_KEY, JSON.stringify(storedRaw))
    }
    db.jadwal_resmi = await store.load()
  }
  return db
}

export async function putDb(env, db) {
  // Split jadwal_resmi out to its own store; the main document stays lean.
  const { jadwal_resmi, ...config } = db
  const store = storeFromEnv(env)
  if (store) {
    if (jadwal_resmi && Object.keys(jadwal_resmi).length) {
      await store.save(jadwal_resmi)
    }
    // jadwal_resmi is always removed from the config document
    await env.DATABASE.put(DB_KEY, JSON.stringify(config))
    return
  }
  // No store: write as-is (backward compatible, e.g. test stubs)
  await env.DATABASE.put(DB_KEY, JSON.stringify(db))
}

// Password admin efektif: nilai tersimpan di db.akses.pass bila operator sudah
// menggantinya, selain itu env.ADMIN_PASS (default untuk instalasi baru).
// Selalu perbandingan string agar aman terhadap nilai non-string.
export function adminPassword(env, db) {
  const stored = String(db?.akses?.pass || '')
  if (stored) return stored
  return String(env?.ADMIN_PASS || DEFAULT_ADMIN_PASS)
}

// True selama password masih default (belum pernah diganti operator).
export function mustChangePass(env, db) {
  return adminPassword(env, db) === DEFAULT_ADMIN_PASS
}

// sha1(string) as lowercase hex, matching PHP sha1() output used by changeDbCheck
export async function sha1Hex(input) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-1', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// PHP original: sha1(json(db).json(wallpapers).filesize(logo)) . strlen(combine)
// v1 only has the db document, so the hash covers the db JSON alone.
export async function hashDb(db) {
  const combine = JSON.stringify(db)
  const hash = await sha1Hex(combine)
  return hash + String(combine.length)
}
