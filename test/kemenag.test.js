// Tests src/lib/kemenag.js with a fake fetch (no real network).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getSession, getJadwalBulanRetry, normalizeJadwal } from '../src/lib/kemenag.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function mockFetch(handlers) {
  // handlers: array of functions (url, options) → Response; called in order
  const calls = []
  globalThis.fetch = vi.fn(async (url, options) => {
    calls.push({ url: String(url), options })
    const handler = handlers[calls.length - 1] || handlers[handlers.length - 1]
    return handler(url, options)
  })
  return calls
}

describe('getSession', () => {
  it('mengambil cookie PHPSESSID dari Set-Cookie', async () => {
    mockFetch([
      () => new Response(null, {
        status: 200,
        headers: { 'Set-Cookie': 'PHPSESSID=abc123; path=/; HttpOnly' }
      })
    ])
    expect(await getSession()).toBe('PHPSESSID=abc123')
  })

  it('melempar error bila status bukan 200 (offline/gangguan)', async () => {
    mockFetch([() => new Response(null, { status: 503 })])
    await expect(getSession()).rejects.toThrow('503')
  })
})

describe('getJadwalBulanRetry', () => {
  const JADWAL_OK = JSON.stringify({
    '2026-10-17': { tanggal: '2026-10-17', subuh: '04:12', terbit: '05:30', dzuhur: '11:45', ashar: '15:05', maghrib: '17:52', isya: '19:05' }
  })

  it('mengirim POST form-encoded dengan x/y/bln/thn dan cookie', async () => {
    const calls = mockFetch([
      () => new Response(null, { status: 200, headers: { 'Set-Cookie': 'PHPSESSID=s1; path=/' } }),
      () => new Response(JADWAL_OK, { status: 200 })
    ])
    const { data: raw, offsetMs } = await getJadwalBulanRetry({ provid: '32', kabkotid: '3275', bulan: 10, tahun: 2026 })
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/jadwalshalat')
    expect(calls[0].options.method).toBe('HEAD')
    expect(calls[1].url).toContain('/ajax/getShalatbln')
    expect(calls[1].options.headers.Cookie).toBe('PHPSESSID=s1')
    const body = calls[1].options.body.toString()
    expect(body).toContain('x=32')
    expect(body).toContain('y=3275')
    expect(body).toContain('bln=10')
    expect(body).toContain('thn=2026')
    expect(raw['2026-10-17'].subuh).toBe('04:12')
    expect(typeof offsetMs === 'number' || offsetMs === null).toBe(true)
  })

  it('refresh sesi & retry sekali bila menjawab Illegal Key', async () => {
    const calls = mockFetch([
      () => new Response(null, { status: 200, headers: { 'Set-Cookie': 'PHPSESSID=lama; path=/' } }),
      () => new Response('Illegal Key', { status: 200 }),
      () => new Response(null, { status: 200, headers: { 'Set-Cookie': 'PHPSESSID=baru; path=/' } }),
      () => new Response(JADWAL_OK, { status: 200 })
    ])
    const { data: raw } = await getJadwalBulanRetry({ provid: '32', kabkotid: '3275', bulan: 10, tahun: 2026 })
    expect(calls).toHaveLength(4)
    expect(calls[3].options.headers.Cookie).toBe('PHPSESSID=baru')
    expect(raw['2026-10-17']).toBeTruthy()
  })

  it('melempar error jaringan apa adanya (mode offline)', async () => {
    mockFetch([() => { throw new TypeError('fetch failed') }])
    await expect(getJadwalBulanRetry({ provid: '32', kabkotid: '3275', bulan: 10, tahun: 2026 }))
      .rejects.toThrow('fetch failed')
  })
})

describe('normalizeJadwal', () => {
  it('mengubah respons Kemenag menjadi map tanggal → waktu PrayTimes-style', () => {
    const raw = {
      '2026-10-01': { tanggal: '2026-10-01', subuh: '04:15', terbit: '05:32', dzuhur: '11:50', ashar: '15:08', maghrib: '17:55', isya: '19:08' },
      '2026-10-02': { tanggal: '2026-10-02', subuh: '04:14', terbit: '05:32', dzuhur: '11:49', ashar: '15:08', maghrib: '17:55', isya: '19:08' }
    }
    const out = normalizeJadwal(raw, 10, 2026)
    expect(Object.keys(out)).toEqual(['2026-10-01', '2026-10-02'])
    expect(out['2026-10-01']).toEqual({
      fajr: '04:15', sunrise: '05:32', dhuhr: '11:50', asr: '15:08', maghrib: '17:55', isha: '19:08'
    })
  })

  it('mendukung format tanggal DD-MM-YYYY dan array', () => {
    const raw = [{ tanggal: '03-10-2026', subuh: '04.14', terbit: '05.32', dzuhur: '11.49', ashar: '15.08', maghrib: '17.55', isya: '19.08' }]
    const out = normalizeJadwal(raw, 10, 2026)
    expect(out['2026-10-03'].fajr).toBe('04:14')
    expect(out['2026-10-03'].isha).toBe('19:08')
  })

  it('mengabaikan baris tanpa tanggal valid', () => {
    expect(normalizeJadwal([{ subuh: '04:00' }], 10, 2026)).toEqual({})
    expect(normalizeJadwal({}, 10, 2026)).toEqual({})
  })
})
