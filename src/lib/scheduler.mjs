// Kemenag official-schedule sync scheduler.
// - On server start and once per day (04:30): when kemenag.active and online,
//   fetch ~3 months ahead (current month + next 2), save to the separate
//   store, then broadcast SSE db-changed → every display auto-reloads.
// - Stale dates are dropped on save (see jadwalStore.js), so storage always
//   rolls over ~3 months and never accumulates.
// - Offline / Kemenag outage → logged only; the display is never disturbed.

import { getDb, putDb } from './db.js'
import { getJadwalBulanRetry, normalizeJadwal } from './kemenag.js'

const SINKRON_JAM = 4.5 // daily run at 04:30 (before fajr)
const BULAN_KE_DEPAN = 3 // current month + next 2

// "Now" as seen by the scheduler. UJI_TANGGAL=YYYY-MM-DD simulates another
// date (for month/year rollover tests only); never set in production.
function sekarang() {
  if (process.env.UJI_TANGGAL) {
    const d = new Date(`${process.env.UJI_TANGGAL}T23:50:00`)
    if (!isNaN(d)) return d
  }
  return new Date()
}

// List of {bulan, tahun} needed to cover the next 3 months.
export function bulanTarget(now = new Date()) {
  const out = []
  for (let i = 0; i < BULAN_KE_DEPAN; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push({ bulan: d.getMonth() + 1, tahun: d.getFullYear() })
  }
  // Dedup (the next month may share the same year)
  return out.filter((t, i, arr) => arr.findIndex((x) => x.bulan === t.bulan && x.tahun === t.tahun) === i)
}

export async function syncKemenag(env, { log = console.log, now } = {}) {
  now = now || sekarang()
  const db = await getDb(env)
  const cfg = db.kemenag || {}
  if (!cfg.active || !cfg.provid || !cfg.kabkotid) {
    return { skipped: true, reason: 'kemenag tidak aktif atau wilayah belum diisi' }
  }

  const jadwal = {}
  let offsetMs = null // Kemenag server time − local clock, for RTC-less STBs
  for (const { bulan, tahun } of bulanTarget(now)) {
    const raw = await getJadwalBulanRetry({
      provid: cfg.provid,
      kabkotid: cfg.kabkotid,
      bulan,
      tahun
    })
    offsetMs = raw.offsetMs ?? offsetMs
    Object.assign(jadwal, normalizeJadwal(raw.data, bulan, tahun))
  }

  if (!Object.keys(jadwal).length) {
    throw new Error('Kemenag: jadwal kosong (format respons mungkin berubah)')
  }

  db.jadwal_resmi = jadwal // putDb moves this to the store and drops stale dates
  db.kemenag = { ...cfg, last_sync: new Date().toISOString() }
  // Real clock offset (for RTC-less STBs): the display shifts all clock logic.
  if (offsetMs !== null) db.time_offset_ms = Math.round(offsetMs)
  await putDb(env, db)
  // Wake every screen so it reloads with the latest schedule
  try {
    await env.HUB.get(env.HUB.idFromName('display')).notify()
  } catch {
    // broadcast is best-effort
  }
  log(`[kemenag] sinkron ${Object.keys(jadwal).length} hari (${bulanTarget(now).map((t) => `${t.tahun}-${t.bulan}`).join(', ')})`)
  return { synced: Object.keys(jadwal).length, last_sync: db.kemenag.last_sync }
}

export function startScheduler(env, { log = console.log } = {}) {
  let timer = null

  async function tick() {
    try {
      await syncKemenag(env, { log })
    } catch (err) {
      // Offline / site outage: the display keeps running on the last data
      log(`[kemenag] sinkron dilewati: ${err.message}`)
    } finally {
      jadwalkanBerikutnya()
    }
  }

  // Schedule the next tick at exactly 04:30 the next day → once per day.
  // (The old scheduler ran every 30 minutes, wasting requests to Kemenag.)
  function jadwalkanBerikutnya() {
    const now = sekarang()
    const next = new Date(now)
    next.setHours(Math.floor(SINKRON_JAM), (SINKRON_JAM % 1) * 60, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    const ms = next.getTime() - now.getTime()
    timer = setTimeout(tick, ms)
    timer.unref?.() // never keep the process alive just for the scheduler
    return next
  }

  // Initial sync on start — only when the 3-month window is complete through
  // the end of month 3 (not merely today). Matters at month/year rollover: data
  // that "covers today" may still miss the next month.
  async function start() {
    try {
      const db = await getDb(env)
      if (db.kemenag?.active) {
        const target = bulanTarget(sekarang())
        const terakhir = target[target.length - 1]
        const akhirBulanKe3 = new Date(terakhir.tahun, terakhir.bulan, 0)
          .toISOString().slice(0, 10)
        const tercakup = db.jadwal_resmi && db.jadwal_resmi[akhirBulanKe3]
        if (tercakup) {
          log('[kemenag] jendela 3 bulan sudah lengkap, sinkron dijadwalkan besok 04:30')
          jadwalkanBerikutnya()
          return
        }
        log('[kemenag] jendela 3 bulan belum lengkap, sinkron awal dijalankan')
      }
    } catch { /* fall through to a normal sync */ }
    tick()
  }

  const nextAt = start()
  return { stop: () => timer && clearTimeout(timer), nextAt }
}
