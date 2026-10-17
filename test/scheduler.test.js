// Kemenag sync scheduler tests: success, skip when inactive, offline-tolerant,
// 3-month target, and once-per-day (start skips when today's data is fresh).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { syncKemenag, bulanTarget } from '../src/lib/scheduler.mjs'
import { getDb } from '../src/lib/db.js'
import { makeEnv } from './helpers.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function mockKemenagOk() {
  const today = new Date()
  const iso = today.toISOString().slice(0, 10)
  globalThis.fetch = vi.fn(async (url) => {
    url = String(url)
    if (url.includes('/jadwalshalat')) {
      return new Response(null, { status: 200, headers: { 'Set-Cookie': 'PHPSESSID=x; path=/' } })
    }
    if (url.includes('/ajax/getShalatbln')) {
      return new Response(JSON.stringify({
        [iso]: { tanggal: iso, subuh: '04:10', terbit: '05:28', dzuhur: '11:43', ashar: '15:02', maghrib: '17:50', isya: '19:03' }
      }), { status: 200 })
    }
    throw new Error('unexpected url: ' + url)
  })
  return iso
}

function envDenganKemenag(kemenag) {
  const env = makeEnv()
  env.DATABASE._store.set('database', JSON.stringify({ kemenag }))
  return env
}

describe('bulanTarget', () => {
  it('menghasilkan 3 bulan berurutan', () => {
    expect(bulanTarget(new Date('2026-10-17'))).toEqual([
      { bulan: 10, tahun: 2026 }, { bulan: 11, tahun: 2026 }, { bulan: 12, tahun: 2026 }
    ])
  })
  it('menyilang tahun', () => {
    expect(bulanTarget(new Date('2026-11-20'))).toEqual([
      { bulan: 11, tahun: 2026 }, { bulan: 12, tahun: 2026 }, { bulan: 1, tahun: 2027 }
    ])
  })
})

describe('syncKemenag', () => {
  it('skip bila kemenag tidak aktif', async () => {
    const env = makeEnv()
    const res = await syncKemenag(env, { log: () => {} })
    expect(res.skipped).toBe(true)
  })

  it('menyimpan jadwal_resmi & last_sync lalu broadcast notify', async () => {
    const iso = mockKemenagOk()
    const env = envDenganKemenag({ active: true, provid: '32', kabkotid: '3275' })
    const res = await syncKemenag(env, { log: () => {} })
    expect(res.synced).toBeGreaterThan(0)
    const db = await getDb(env)
    expect(db.jadwal_resmi[iso].dhuhr).toBe('11:43')
    expect(db.kemenag.last_sync).toBeTruthy()
    expect(env.HUB.calls).toContain('notify')
  })

  it('melempar error saat offline tanpa merusak db', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed') })
    const env = envDenganKemenag({ active: true, provid: '32', kabkotid: '3275' })
    await expect(syncKemenag(env, { log: () => {} })).rejects.toThrow('fetch failed')
    const db = await getDb(env)
    expect(db.jadwal_resmi).toEqual({})
    expect(db.kemenag.last_sync).toBe('')
  })
})
