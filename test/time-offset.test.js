// Real clock-offset tests in the display: when db.time_offset_ms is set (RTC-less
// STB with a drifting clock), app.now() must shift the clock by the offset and
// every schedule must follow the corrected time.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

describe('offset waktu STB (tanpa RTC)', () => {
  it('tanpa offset, app.now() ≈ waktu sistem', () => {
    const { app } = bootApp(baseDb(), '2026-10-17T08:00:00+07:00')
    const selisih = Math.abs(app.now().valueOf() - new Date('2026-10-17T08:00:00+07:00').getTime())
    expect(selisih).toBeLessThan(2000) // toleransi tick 1s
  })

  it('offset +2 jam menggeser app.now() ke depan 2 jam', () => {
    const db = baseDb({ time_offset_ms: 2 * 60 * 60 * 1000 })
    const { app } = bootApp(db, '2026-10-17T08:00:00+07:00')
    // system 08:00, offset +2h → app.now() must be 10:00
    expect(app.now().format('HH:mm')).toBe('10:00')
  })

  it('offset mengubah tanggal saat melintasi tengah malam', () => {
    // System 23:30 Oct 17, offset +1h → the app must already be at Oct 18 00:30
    const db = baseDb({ time_offset_ms: 60 * 60 * 1000 })
    const { app } = bootApp(db, '2026-10-17T23:30:00+07:00')
    expect(app.now().format('YYYY-MM-DD HH:mm')).toBe('2026-10-18 00:30')
  })

  it('jadwal mengikuti tanggal hasil offset (pilih jadwal_resmi tanggal baru)', () => {
    // System 23:50 (Oct 18 per the +30m offset), the official file has Oct 18
    const resmi18 = { fajr: '04:21', sunrise: '05:33', dhuhr: '11:46', asr: '14:54', maghrib: '17:53', isha: '19:03' }
    const db = baseDb({
      time_offset_ms: 30 * 60 * 1000,
      jadwal_resmi: { '2026-10-18': resmi18 }
    })
    const { app } = bootApp(db, '2026-10-17T23:50:00+07:00')
    // app.now() = 2026-10-18 00:20 → the schedule used must be the Oct 18 entry
    expect(app.jadwalHariIni).toEqual(resmi18)
  })
})
