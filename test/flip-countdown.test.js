// Flip-digit animation tests for countdowns (pre-adhan & iqomah):
// each digit renders as its own .flip-digit card; the .flip-anim class is added
// only when the value changes (seconds flip every second, minutes only on change).
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment } from './display-harness.js'

afterEach(() => {
  vi.useRealTimers()
})

const digitSel = (overlay, loc) => `${overlay} .flip-digit[data-loc="${loc}"]`
const flipAdds = (state, sel) => state.calls.filter((c) => c[0] === sel && c[1] === 'addClass:flip-anim').length
const textWrites = (state, sel) => state.calls.filter((c) => c[0] === sel && c[1] === 'text').length

describe('restart animasi flip (forced reflow)', () => {
  it('setiap flip melewati forced reflow di antara removeClass dan addClass', () => {
    // Boot INSIDE the real iqomah window (Ashar 15:00 + adzan 3 menit → iqomah
    // 15:03–15:13). displaySchedule menghentikan timer yang fasenya tidak sah,
    // jadi countdown harus berjalan pada window nyata, bukan dipanggil manual.
    const { state } = bootApp(baseDb(), '2026-08-29T15:03:10')
    vi.advanceTimersByTime(4 * 1000) // beberapa tick → beberapa perubahan digit

    // On the seconds units digit the call order must be: removeClass → reflow → addClass,
    // repeated on every change. Without reflow, the browser does not restart the animation.
    const sel = '#count-down .flip-digit[data-loc="sec-units"]'
    const seq = []
    for (const [s, op] of state.calls) {
      if (s !== sel) continue
      if (op === 'removeClass:flip-anim') seq.push('remove')
      if (op === 'addClass:flip-anim') seq.push('add')
    }
    const reflCount = state.reflows.filter((s) => s === sel).length

    expect(seq.length).toBeGreaterThanOrEqual(4) // minimal 2 siklus remove/add
    expect(reflCount).toBeGreaterThanOrEqual(seq.filter((x) => x === 'add').length)

    // Every 'add' must be preceded by 'remove' then reflow (strict remove→add order)
    for (let i = 1; i < seq.length; i += 2) {
      expect(seq[i - 1]).toBe('remove')
      expect(seq[i]).toBe('add')
    }
  })
})

describe('judul counter', () => {
  it('countdown menuju adzan berjudul "Menuju Adzan"', () => {
    const start = moment('2026-08-29T15:00:00').subtract(30, 'seconds')
    const { state } = bootApp(baseDb(), start.toISOString())
    vi.advanceTimersByTime(5 * 1000)
    expect(state.texts['#right-counter .counter>h1']).toBe('Menuju Adzan')
  })

  it('countdown iqomah berjudul "Menuju Iqomah"', () => {
    // Boot di dalam window iqomah Ashar (15:03–15:13)
    const { state } = bootApp(baseDb(), '2026-08-29T15:03:10')
    vi.advanceTimersByTime(2 * 1000)
    expect(state.texts['#count-down .counter>h1']).toBe('Menuju Iqomah')
  })
})

describe('animasi flip digit countdown', () => {
  it('digit countdown menuju adzan flip tiap detik, menit tetap saat tidak berubah', () => {
    // 30 seconds before Asr: already inside the pre-adhan window,
    // minutes stay 00 for the whole observation
    const start = moment('2026-08-29T15:00:00').subtract(30, 'seconds')
    const { state } = bootApp(baseDb(), start.toISOString())

    vi.advanceTimersByTime(15 * 1000)

    const selSecUnits = digitSel('#right-counter', 'sec-units')
    const selSecTens = digitSel('#right-counter', 'sec-tens')
    const selMinUnits = digitSel('#right-counter', 'min-units')

    // Digit values are recorded (rendering happened)
    expect(state.texts[selSecUnits]).toMatch(/^\d$/)
    expect(state.texts[selSecTens]).toMatch(/^\d$/)
    expect(state.texts[selMinUnits]).toMatch(/^\d$/)

    // The seconds units digit updates almost every second
    expect(textWrites(state, selSecUnits)).toBeGreaterThanOrEqual(8)
    // Flips fire repeatedly on the seconds digit
    expect(flipAdds(state, selSecUnits)).toBeGreaterThanOrEqual(5)

    // The minutes digit does not change → no flip
    expect(flipAdds(state, selMinUnits)).toBe(0)
  })

  it('digit menit ikut flip saat pergantian menit (09 → 08)', () => {
    // Boot di window iqomah Ashar; sisa iqomah 15:13 − 15:03:10 = 9:50 → mulai 09:xx
    const { state } = bootApp(baseDb(), '2026-08-29T15:03:10')

    // The first tick renders 09:xx without animation (initial render)
    vi.advanceTimersByTime(1500)
    const selMinUnits = digitSel('#count-down', 'min-units')
    expect(state.texts[selMinUnits]).toBe('9')

    // Cross the minute boundary 09:xx → 08:xx (60 more seconds) → the minute must flip
    vi.advanceTimersByTime(70 * 1000)
    expect(flipAdds(state, selMinUnits)).toBeGreaterThanOrEqual(1)
    expect(state.texts[selMinUnits]).toBe('8')
  })

  it('overlay iqomah (#count-down) juga flip digit', () => {
    // Start 2 minutes before Maghrib; +330s means the 3m adhan has passed and
    // the iqomah window is active
    const start = moment('2026-08-29T18:00:00').subtract(2, 'minutes')
    const { state } = bootApp(baseDb(), start.toISOString())
    vi.advanceTimersByTime(330 * 1000)

    const selSecUnits = digitSel('#count-down', 'sec-units')
    expect(flipAdds(state, selSecUnits)).toBeGreaterThanOrEqual(5)
  })
})
