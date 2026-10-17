// Regression guard — user-reported bug: iqomah countdown seconds "jump"
// (e.g. 34 → 33 → 31, skipping 32) or repeat then jump (33 → 33 → 31).
//
// Root cause (analyzed & reproduced):
//   1. Seconds were derived from wall time each tick (Math.round(distance)).
//      setInterval(1000) is imprecise: a late tick on a busy main thread lets
//      wall time advance >1s → one second value is skipped (SKIP).
//   2. Math.round (not floor) can produce a repeated value then a jump (REPEAT).
//
// This test locks in the fix:
//   - Math.floor → samples ≥ ~900ms apart always differ (no repeats).
//   - Monotonic floor → at most 1 decrement per tick (no jumps).
//   Together: seconds always advance -1 per tick.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb, moment } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

// Samples the seconds value rendered on each tick (ms offset from t0) using
// the real production code (app.countDownCalculate), without moving timers.
function amatiDetik(app, target, t0, offsetsMs) {
  return offsetsMs.map((off) => {
    vi.setSystemTime(t0.clone().add(off, 'ms').toDate())
    return Number(app.countDownCalculate(target).seconds)
  })
}

describe('detik countdown monotonik (tidak melompat)', () => {
  it('tick telat ~2 detik: detik tetap 34→33→32→31, tidak melewati 32', () => {
    const startIso = '2026-08-29T15:00:00.000'
    const { app } = bootApp(baseDb(), startIso)
    const target = moment(startIso).add(10, 'minutes')
    const t0 = target.clone().subtract(34400, 'ms') // sisa 34.4 detik

    // Ticks are ideally 1000ms apart; the 3rd tick is late (3000ms from t0).
    const teramati = amatiDetik(app, target, t0, [0, 1000, 3000, 4000])
    console.log('detik (tick telat):', JSON.stringify(teramati))

    // No jumps: the difference between ticks is exactly 1.
    for (let i = 1; i < teramati.length; i++) {
      expect(teramati[i - 1] - teramati[i]).toBe(1)
    }
    expect(teramati[0]).toBe(34)
    expect(teramati[1]).toBe(33)
    expect(teramati[2]).toBe(32) // SEBELUM fix: 31 (melewati 32)
    expect(teramati[3]).toBe(31)
  })

  it('tick sedikit telat (1.2s) dengan fase .5: tidak melompat', () => {
    const startIso = '2026-08-29T15:00:00.000'
    const { app } = bootApp(baseDb(), startIso)
    const target = moment(startIso).add(10, 'minutes')
    const t0 = target.clone().subtract(20500, 'ms') // sisa 20.5 detik

    // Note: setInterval never fires EARLIER than its interval — it can only be
    // late. So the offset is always >= 1000ms. The .5 phase distinguishes
    // Math.round (old: 21 → 19, skipping 20) from Math.floor (new: 20 → 19).
    const teramati = amatiDetik(app, target, t0, [0, 1500, 3000])
    console.log('detik (telat 1.5s):', JSON.stringify(teramati))

    for (let i = 1; i < teramati.length; i++) {
      expect(teramati[i - 1] - teramati[i]).toBe(1)
    }
  })

  it('drift besar (freeze) → re-sync ke jam dinding agar iqomah tetap tepat waktu', () => {
    const startIso = '2026-08-29T15:00:00.000'
    const { app } = bootApp(baseDb(), startIso)
    const target = moment(startIso).add(10, 'minutes')
    const t0 = target.clone().subtract(34400, 'ms')

    // 10-second freeze: the monotonic clamp must not hold the display forever,
    // or iqomah would start late. Drift >= threshold → snap to wall time.
    const teramati = amatiDetik(app, target, t0, [0, 1000, 11000])
    console.log('detik (freeze 10s):', JSON.stringify(teramati))

    expect(teramati[0]).toBe(34)
    expect(teramati[1]).toBe(33)
    // The final value must reflect real wall time (23 = floor(23.4)), not the
    // clamped result (32) — iqomah timing accuracy matters more during a real freeze.
    expect(teramati[2]).toBe(23)
  })

  it('tick berjarak sama tetap -1 per detik (tidak mengubah perilaku normal)', () => {
    const startIso = '2026-08-29T15:00:00.000'
    const { app } = bootApp(baseDb(), startIso)
    const target = moment(startIso).add(10, 'minutes')
    const t0 = target.clone().subtract(20500, 'ms')

    const teramati = amatiDetik(app, target, t0, [0, 1000, 2000, 3000, 4000])
    console.log('detik (normal):', JSON.stringify(teramati))
    expect(teramati).toEqual([20, 19, 18, 17, 16])
  })

  it('40 tick + freeze 8 detik di tengah → monotonik sampai snap ke jam dinding', () => {
    const startIso = '2026-08-29T15:00:00.000'
    const { app } = bootApp(baseDb(), startIso)
    const target = moment(startIso).add(10, 'minutes')
    const t0 = target.clone().subtract(34900, 'ms') // sisa 34.9 detik → mulai 34

    const offsets = [0, 1000, 2000, 3000, 10000] // ada jump 8 detik pada offset ke-5
    const teramati = amatiDetik(app, target, t0, offsets)
    console.log('urutan dengan jump (40 tick versi compact):', JSON.stringify(teramati))

    expect(teramati[0]).toBe(34)
    expect(teramati[1]).toBe(33)
    // Monotonic during normal ≤1s intervals. On a big jump → re-sync to wall time.
    // floor(34.9 - 10) ≈ 24.9 → floor 24, not the clamped 30.
    expect(teramati[4]).toBe(24)
  })

  it('clock mundur (NTP backward jump) → countdown tidak freeze selamanya', () => {
    const startIso = '2026-08-29T15:00:00.000'
    const { app } = bootApp(baseDb(), startIso)
    const target = moment(startIso).add(10, 'minutes')
    const t0 = target.clone().subtract(20500, 'ms') // sisa 20.5 detik → mulai 20

    // Wall clock moves backward for 5 ticks (e.g. NTP/fake-hwclock correction).
    const offsets = [0, -1000, -2000, -3000, -4000, -5000, -6000]
    const teramati = amatiDetik(app, target, t0, offsets)
    console.log('detik (clock mundur):', JSON.stringify(teramati))

    // First 3 ticks may hold at 20; after MAX_HOLD_TICKS it must re-sync to wall time.
    expect(teramati[0]).toBe(20)
    expect(teramati[1]).toBe(20)
    expect(teramati[2]).toBe(20)
    expect(teramati[3]).toBe(20)
    // After 3 holds, the next tick re-syncs: wallDistance = 20 - (-4) = 24
    expect(teramati[4]).toBe(24)
    // While the clock keeps moving backward, the value holds at the resynced level.
    expect(teramati[5]).toBe(24)
    expect(teramati[6]).toBe(24)
  })
})
