// Regression: a stale countdown timer (e.g. iqomah left running from a previous
// cycle, or after the clock jumps backwards) must not block the next phase.
// Symptom observed live: Menuju Adzan never appeared because countDownTimer was
// still `running` with the old iqomah target (fajr + adzan + iqomah).
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment, SIM_PRAYER_TIMES } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

describe('timer countdown basi tidak memblokir fase berikutnya', () => {
  it('timer iqomah lama dengan target lain dihentikan, Menuju Adzan tampil', () => {
    const db = baseDb({ timer: { wait_adzan: 1, adzan: 3 }, iqomah: { fajr: 15, dhuhr: 15, asr: 15, maghrib: 15, isha: 15 } })
    // Boot 30s before fajr → Menuju Adzan window (wait_adzan = 60s)
    const mulai = moment('2026-10-18T' + SIM_PRAYER_TIMES.fajr + ':00').subtract(30, 'seconds')
    const { app, state } = bootApp(db, mulai.toISOString())
    vi.advanceTimersByTime(1200)

    // Inject a STALE timer exactly like the live bug: running in the 'iqomah'
    // phase while the real schedule is in the pre-adhan window.
    app.countDownTimer = { running: true, fase: 'iqomah', interval: setInterval(() => {}, 100000) }
    app.countDownTarget = moment('2026-10-18T' + SIM_PRAYER_TIMES.fajr + ':00').add(3, 'minutes').add(15, 'minutes').valueOf()

    // Next tick must detect the stale phase and restart as Menuju Adzan
    vi.advanceTimersByTime(1200)
    expect(app.countDownTimer.fase).toBe('menuju')
    expect(state.texts['#right-counter .counter>h1']).toBe('Menuju Adzan')
  })

  it('di luar semua window, timer fase lain dihentikan dan overlay disembunyikan', () => {
    const db = baseDb({ timer: { wait_adzan: 1, adzan: 3 } })
    // 10:00 → jauh dari semua window
    const { app, state } = bootApp(db, '2026-10-18T10:00:00')
    vi.advanceTimersByTime(1200)

    // Target di masa depan (mis. iqomah siklus yang salah) tetapi di luar window
    app.countDownTimer = { running: true, fase: 'iqomah', interval: setInterval(() => {}, 100000) }
    app.countDownTarget = moment('2026-10-18T23:59:00').valueOf()

    vi.advanceTimersByTime(1200)
    expect(app.countDownTimer).toBe(false)
    expect(app.countDownTarget).toBe(null)
    expect(state.visible['#count-down']).toBe(false)
    expect(state.visible['#right-counter']).toBe(false)
  })
})
