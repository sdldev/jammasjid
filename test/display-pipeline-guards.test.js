// Pipeline re-entry guards: calling displaySchedule every second inside the same
// window must not duplicate the adzan timeout or the iqomah interval.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment, SIM_PRAYER_TIMES } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

describe('guard re-entry pipeline sholat', () => {
  it('showDisplayAdzan tidak membuat timer baru saat dipanggil berulang di window adzan', () => {
    const db = baseDb({ timer: { wait_adzan: 1, adzan: 3 } })
    // Boot 10s after dhuhr starts (inside the 3-minute adzan window)
    const { app } = bootApp(db, '2026-08-29T' + SIM_PRAYER_TIMES.dhuhr + ':10')
    vi.advanceTimersByTime(1000)

    const timerPertama = app.adzanTimer
    expect(timerPertama).toBeTruthy()

    // Call the same phase repeatedly
    for (let i = 0; i < 5; i++) {
      app.displaySchedule()
      vi.advanceTimersByTime(1000)
    }
    expect(app.adzanTimer).toBe(timerPertama)
  })

  it('runFullCountDown tidak membuat interval baru saat dipanggil berulang di window iqomah', () => {
    const db = baseDb({ timer: { wait_adzan: 1, adzan: 3 }, iqomah: { dhuhr: 10 } })
    // Boot at dhuhr + 4 minutes (inside the 10-minute iqomah window)
    const mulai = moment('2026-08-29T' + SIM_PRAYER_TIMES.dhuhr + ':00').add(4, 'minutes')
    const { app } = bootApp(db, mulai.toISOString())
    vi.advanceTimersByTime(1000)

    const intervalPertama = app.countDownTimer && app.countDownTimer.interval
    expect(intervalPertama).toBeTruthy()

    for (let i = 0; i < 5; i++) {
      app.displaySchedule()
      vi.advanceTimersByTime(1000)
    }
    expect(app.countDownTimer.interval).toBe(intervalPertama)
  })
})
