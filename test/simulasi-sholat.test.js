// Per-prayer display pipeline simulation with fake timers.
// Cycle timeline (test default db values):
//   Pre-adhan (1 min) → Adhan (3 min) → Iqomah (10 min) → main display.
// Friday Dhuhr: after the adhan, STRAIGHT back to the main display
//   (no iqomah, no khutbah — the khutbah feature has been removed).
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment } from './display-harness.js'

afterEach(() => {
  vi.useRealTimers()
})

// Fake schedule from the PrayTimes stub in display-harness.js
const PRAY_TIMES = { fajr: '04:30', dhuhr: '12:00', asr: '15:00', maghrib: '18:00', isha: '19:10' }

function phaseOf(state) {
  if (state.visible['#display-adzan']) return 'adzan'
  if (state.visible['#count-down']) return 'iqomah'
  if (state.visible['#right-counter']) return 'right-counter'
  return 'main'
}

// Run second by second from 70s before prayer time until the pipeline returns
// to the main display (stable for 45s). Returns the phase sequence.
// Exits once the adhan has been observed and the main phase is stable — covering
// weekdays (adhan → iqomah → main) and Friday (adhan → main, no iqomah).
function runPipeline(prayISO, db) {
  const start = moment(prayISO).subtract(70, 'seconds')
  const { app, state } = bootApp(db, start.toISOString())

  const phases = []       // urutan fase tanpa pengulangan beruntun
  let quietTicks = 0
  let seenAdzan = false
  let lastPhase = null

  for (let i = 0; i < 2400; i++) {
    vi.advanceTimersByTime(1000)
    const p = phaseOf(state)
    if (p !== lastPhase) {
      phases.push(p)
      lastPhase = p
    }
    if (p === 'adzan') seenAdzan = true
    if (seenAdzan && p === 'main') {
      quietTicks++
      if (quietTicks >= 45) break
    } else {
      quietTicks = 0
    }
  }

  return { app, state, phases }
}

const NORMAL_SEQUENCE = ['right-counter', 'adzan', 'iqomah']

describe('simulasi pipeline 5 waktu sholat (hari biasa)', () => {
  for (const [name, time] of Object.entries(PRAY_TIMES)) {
    it(`waktu ${name} (${time}): Menuju → Adzan → Iqomah → kembali ke utama`, () => {
      // 2026-08-29 = Saturday (not Friday)
      const { app, phases, state } = runPipeline(`2026-08-29T${time}:00`, baseDb())

      // Exact overlay sequence (leading/trailing 'main' phases ignored)
      const overlaySeq = phases.filter((p) => p !== 'main')
      expect(overlaySeq).toEqual(NORMAL_SEQUENCE)

      // The prayer overlay never appears (element & logic removed)
      expect(state.visible['#display-sholat']).toBeFalsy()
      // Adzan label includes the "Adzan" prefix
      expect(state.texts['#display-adzan>div']).toBe('Adzan ' + app.db.prayName[name])
      // End-of-iqomah beep was played
      expect(state.audioPlays).toBeGreaterThan(0)
    })
  }
})

describe('simulasi Jumat: setelah adzan langsung ke tampilan utama', () => {
  it('Jumat Dzuhur: Menuju → Adzan → utama (TANPA khutbah & tanpa iqomah)', () => {
    // 2026-08-28 = Friday
    const { phases, state } = runPipeline(`2026-08-28T${PRAY_TIMES.dhuhr}:00`, baseDb())

    const overlaySeq = phases.filter((p) => p !== 'main')
    expect(overlaySeq).toEqual(['right-counter', 'adzan'])

    // Khutbah is fully removed; iqomah does not run for Friday Dhuhr
    expect(state.visible['#display-khutbah']).toBeFalsy()
    expect(state.visible['#count-down']).toBeFalsy()
  })

  it('Jumat waktu lain (Ashar) tetap pipeline normal dengan iqomah', () => {
    // Only Dhuhr is special on Friday; other prayers are unchanged
    const { phases } = runPipeline(`2026-08-28T${PRAY_TIMES.asr}:00`, baseDb())
    expect(phases.filter((p) => p !== 'main')).toEqual(NORMAL_SEQUENCE)
  })
})

describe('shuruq bukan waktu sholat', () => {
  it('tidak ada overlay adzan/iqomah di sekitar waktu shuruq', () => {
    const db = baseDb()
    const start = moment('2026-08-29T05:50:00').subtract(70, 'seconds')
    const { state } = bootApp(db, start.toISOString())
    for (let i = 0; i < 700; i++) vi.advanceTimersByTime(1000)
    expect(state.visible['#display-adzan']).toBeFalsy()
    expect(state.visible['#count-down']).toBeFalsy()
  })
})
