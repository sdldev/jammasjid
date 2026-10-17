// Memory-reset watchdog tests: reload ONLY inside the 13:00 window AND when the
// internet is proven alive (recent successful checkDbChange) AND uptime > 24h.
// Net down → lastCheckTime null/stale → reload deferred, the screen never blanks.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment } from './display-harness.js'

afterEach(() => {
  vi.useRealTimers()
})

// Boot at 09:00 on day A. Uptime is measured from here.
const BOOT = '2026-08-31T09:00:00'

// Simulate a recent successful checkDbChange (net alive):
// call the method, then fire the $.post callback with the same hash → else branch.
function simulateNetOk(app, state, hash) {
  state.lastPostSuccess({ data: hash }) // isi app.cekDb via getDbHash callback
  app.checkDbChange()                    // post baru, lastPostSuccess = checkDbChange callback
  state.lastPostSuccess({ data: hash }) // hash sama -> set app.lastCheckTime
}

describe('watchdog reload aman', () => {
  it('net hidup + jam 13 + uptime > 24 jam -> reload', () => {
    const { app, state } = bootApp(baseDb(), BOOT)
    // Advance 28h → 13:00 the next day, uptime > 24h
    vi.setSystemTime(moment(BOOT).add(28, 'hours').toDate())
    // Net proven alive just before the window: DB check succeeds at 13:00
    simulateNetOk(app, state, 'hashA')
    app.watchDog()
    expect(state.reloads).toBe(1)
  })

  it('net gangguan (lastCheckTime null) + jam 13 + uptime > 24 jam -> TIDAK reload', () => {
    const { app, state } = bootApp(baseDb(), BOOT)
    // No successful checkDbChange ever → lastCheckTime stays null
    vi.setSystemTime(moment(BOOT).add(28.5, 'hours').toDate())
    app.watchDog()
    expect(state.reloads).toBe(0)
  })

  it('net hidup + jam 13 tapi uptime masih baru (< 24 jam) -> TIDAK reload', () => {
    const { app, state } = bootApp(baseDb(), BOOT)
    // Advance 4.5h → 13:30 the same day (still in the window), fresh uptime
    vi.setSystemTime(moment(BOOT).add(4.5, 'hours').toDate())
    simulateNetOk(app, state, 'hashA')
    app.watchDog()
    expect(state.reloads).toBe(0)
  })

  it('net hidup + uptime > 24 jam tapi DI LUAR jendela jam 13 -> TIDAK reload', () => {
    const { app, state } = bootApp(baseDb(), BOOT)
    // Advance 32h → 17:00 the next day (outside 13:00-13:59)
    vi.setSystemTime(moment(BOOT).add(32, 'hours').toDate())
    simulateNetOk(app, state, 'hashA')
    app.watchDog()
    expect(state.reloads).toBe(0)
  })

  it('net hidup tapi sudah basi (sukses > 2 jam lalu) + jam 13 -> TIDAK reload', () => {
    const { app, state } = bootApp(baseDb(), BOOT)
    // Last success at 09:00 on day A (at boot)
    simulateNetOk(app, state, 'hashA')
    // Advance to 13:30 on day A+1: the net-alive proof is 28.5h old → stale
    vi.setSystemTime(moment(BOOT).add(28.5, 'hours').toDate())
    app.watchDog()
    expect(state.reloads).toBe(0)
  })
})
