// Display overlay layer tests, from the inline script in src/templates/index.html.
// Flow: pre-adhan countdown → Adhan → Iqomah → straight back to the main display
// (no prayer overlay). Friday Dhuhr: after the adhan, straight back to main
// (the khutbah feature has been removed entirely).
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment } from './display-harness.js'

afterEach(() => {
  vi.useRealTimers()
})

// System clock 09:00 — outside every adhan/iqomah window of the fake schedule.
const NOW = '2026-08-31T09:00:00'

describe('siklus selesai → tampilan utama', () => {
  it('iqomah selesai langsung kembali ke tampilan utama (tanpa overlay sholat)', () => {
    const { app, state } = bootApp(baseDb(), NOW)
    const target = moment(NOW).add(1, 'minutes')
    app.runFullCountDown(target, 'IQOMAH')

    // 70 seconds: the 1-minute iqomah completes
    vi.advanceTimersByTime(70 * 1000)

    expect(state.visible['#count-down']).toBe(false)
    expect(state.visible['#display-sholat']).toBeFalsy() // overlay sholat tidak ada lagi
    expect(app.countDownTimer).toBe(false)
  })

  it('endCycle menyembunyikan semua overlay full-screen', () => {
    const { app, state } = bootApp(baseDb(), NOW)
    state.visible['#display-adzan'] = true
    state.visible['#count-down'] = true
    app.endCycle()
    expect(state.visible['#display-adzan']).toBe(false)
    expect(state.visible['#count-down']).toBe(false)
  })

  it('jam pojok kanan bawah tampil saat overlay Menuju Adzan (right-counter)', () => {
    // Boot 30s sebelum Fajr (stub PrayTimes 04:30) agar fase Menuju Adzan sah;
    // pembersih timer di displaySchedule menghentikan countdown yang targetnya
    // di luar window aktif, jadi test harus memakai window nyata.
    const mulai = moment('2026-08-31T04:29:30')
    const { state } = bootApp(baseDb(), mulai.toISOString())

    vi.advanceTimersByTime(2500)
    expect(state.visible['#right-counter']).toBe(true)
    expect(state.visible['#full-screen-clock']).toBe(true)
  })
})
