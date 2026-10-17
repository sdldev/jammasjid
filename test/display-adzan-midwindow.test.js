// Regression: page reload in the MIDDLE of the adhan window. The overlay timer
// must end when the adhan window ends (based on the prayer time), not restart
// the full duration; and the fade-out must not be cancelled by a re-show while
// still inside the window.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment, SIM_PRAYER_TIMES } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

describe('adzan overlay saat reload di tengah window', () => {
  it('overlay menutup saat window adzan berakhir (bukan durasi penuh dari show)', () => {
    const db = baseDb({ timer: { wait_adzan: 1, adzan: 3 } })
    // Boot 2 minutes INTO the 3-minute adhan window (e.g. SSE reload / reboot).
    const mulai = moment('2026-08-29T' + SIM_PRAYER_TIMES.dhuhr + ':00').add(2, 'minutes')
    const { app, state } = bootApp(db, mulai.toISOString())
    vi.advanceTimersByTime(1000)

    // Overlay appears immediately with the "Adzan" label
    expect(state.visible['#display-adzan']).toBe(true)
    expect(state.texts['#display-adzan>div']).toBe('Adzan Dzuhur')

    // Advance past the window end (adhan = 3 minutes): overlay must be gone.
    // Boot+1s → 2:01 into window. sisaMs = (180-121.5)s ≈ 58.5s + fade 800ms.
    vi.advanceTimersByTime(60 * 1000) // ~3:01 into window → timer fired + fade done
    expect(state.visible['#display-adzan']).toBe(false)
  })

  it('timer adzan tidak dijadwalkan ulang saat masih dalam window setelah fade', () => {
    const db = baseDb({ timer: { wait_adzan: 1, adzan: 3 } })
    // Boot 2.5 minutes in: remaining window ~30s — fade fires INSIDE the window.
    const mulai = moment('2026-08-29T' + SIM_PRAYER_TIMES.dhuhr + ':00').add(150, 'seconds')
    const { app, state } = bootApp(db, mulai.toISOString())
    vi.advanceTimersByTime(1000)

    expect(state.visible['#display-adzan']).toBe(true)
    const timerPertama = app.adzanTimer
    expect(timerPertama).toBeTruthy()

    // Run past the timer: the fade fires ~31.5s later, while still in-window
    // (detik ≈ -28.5 > -180). The guard must NOT re-show forever: advance well
    // past the window end and the overlay must end up hidden exactly once closed.
    vi.advanceTimersByTime(120 * 1000) // ~2.5 minutes → window long over
    expect(state.visible['#display-adzan']).toBe(false)
  })
})
