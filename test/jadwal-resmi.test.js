// Tests the Kemenag official-schedule priority in the display (getJadwal):
// jadwal_resmi[date] wins when present; otherwise fall back to local PrayTimes.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, SIM_PRAYER_TIMES } from './display-harness.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('getJadwal dengan jadwal resmi Kemenag', () => {
  it('memakai db.jadwal_resmi untuk tanggal yang tersedia', () => {
    const now = '2026-10-17T08:00:00+07:00'
    const resmi = { fajr: '04:10', sunrise: '05:28', dhuhr: '11:43', asr: '15:02', maghrib: '17:50', isha: '19:03' }
    const db = baseDb({ jadwal_resmi: { '2026-10-17': resmi } })
    const { app } = bootApp(db, now)
    const jadwal = app.getJadwal(new Date('2026-10-17T00:00:00+07:00'))
    expect(jadwal).toEqual(resmi)
    // Differs from the PrayTimes stub → proof the local calculation was not used
    expect(jadwal.dhuhr).not.toBe(SIM_PRAYER_TIMES.dhuhr)
  })

  it('fallback ke PrayTimes lokal untuk tanggal tanpa jadwal resmi', () => {
    const db = baseDb({ jadwal_resmi: { '2026-10-17': { fajr: '04:10', dhuhr: '11:43', maghrib: '17:50' } } })
    const { app } = bootApp(db, '2026-10-17T08:00:00+07:00')
    const jadwal = app.getJadwal(new Date('2026-10-18T00:00:00+07:00'))
    expect(jadwal).toEqual(SIM_PRAYER_TIMES)
  })

  it('fallback bila db tidak punya key jadwal_resmi sama sekali', () => {
    const { app } = bootApp(baseDb(), '2026-10-17T08:00:00+07:00')
    expect(app.getJadwal(new Date('2026-10-17T00:00:00+07:00'))).toEqual(SIM_PRAYER_TIMES)
  })

  it('fallback bila jadwal resmi tidak lengkap', () => {
    const db = baseDb({ jadwal_resmi: { '2026-10-17': { fajr: '04:10' } } })
    const { app } = bootApp(db, '2026-10-17T08:00:00+07:00')
    expect(app.getJadwal(new Date('2026-10-17T00:00:00+07:00'))).toEqual(SIM_PRAYER_TIMES)
  })

  it('fallback bila salah satu field pipeline kosong (mis. asr)', () => {
    const resmiParsial = { fajr: '04:10', sunrise: '05:28', dhuhr: '11:43', asr: '', maghrib: '17:50', isha: '19:03' }
    const db = baseDb({ jadwal_resmi: { '2026-10-17': resmiParsial } })
    const { app } = bootApp(db, '2026-10-17T08:00:00+07:00')
    expect(app.getJadwal(new Date('2026-10-17T00:00:00+07:00'))).toEqual(SIM_PRAYER_TIMES)
  })
})
