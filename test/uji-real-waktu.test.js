// REAL-TIME test: run the display script against the real system clock (no fake
// timers) and observe overlay phases around actual prayer times.
//
// Modes:
//   UJI_MODE=real (default): real system clock; target via env UJI_JAM 'HH:mm'
//     (default: the stub schedule). Wait for the window, then observe per second.
//   UJI_MODE=sim: fake timers at a given date/time (env UJI_TANGGAL
//     'YYYY-MM-DD HH:mm:ss') — test without waiting for a real prayer time.
//
// Pipeline: pre-adhan → Adhan → Iqomah → main display.
// (The Friday khutbah feature is fully removed; Friday Dhuhr now goes straight
//  back to the main display after the adhan.)
//
// Examples:
//   UJI_MODE=sim npx vitest run test/uji-real-waktu.test.js
//   UJI_MODE=sim UJI_JAM=12:00 npx vitest run test/uji-real-waktu.test.js
//   UJI_MODE=real UJI_PRAYER=dhuhr npx vitest run test/uji-real-waktu.test.js
//
// In sim mode the displayed schedule comes from SIM_PRAYER_TIMES in
// display-harness.js. UJI_JAM must match that value for the chosen
// UJI_PRAYER, otherwise the simulation starts outside the prayer window
// and no phase is observed. Do not reuse the real-mode REAL_TIMES
// defaults for UJI_JAM in sim mode.
//
// Without UJI_MODE/UJI_JAM this test skips automatically — the regression suite
// never has to wait for real prayer windows (which can be hours away).
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractInlineScript, makeJquery, baseDb, bootApp, moment, SIM_PRAYER_TIMES } from './display-harness.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const TEMPLATE = readFileSync(path.join(ROOT, 'src', 'templates', 'index.html'), 'utf-8')

const UJI_MODE = process.env.UJI_MODE || 'real'
const REAL_PRAYER = process.env.UJI_PRAYER || 'dhuhr'
const REAL_MENIT = Number(process.env.UJI_MENIT || 3)

const REAL_TIMES = {
  fajr: '04:34', sunrise: '05:46', dhuhr: '11:55',
  asr: '14:58', maghrib: '17:52', isha: '19:02'
}

function overlayPhase(state) {
  if (state.visible['#display-adzan']) return 'ADZAN'
  if (state.visible['#count-down']) return 'IQOMAH'
  if (state.visible['#right-counter']) return 'MENUJU'
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildApp() {
  let code = extractInlineScript(TEMPLATE)
  const db = baseDb({ timer: { wait_adzan: REAL_MENIT, adzan: 3 } })
  code = code
    .replace(/__LAT__/g, '-5.59')
    .replace(/__LNG__/g, '105.5')
    .replace(/__TIMEZONE__/g, '7')
    .replace(/__DST__/g, '0')
    .replace("'__PRAY_TIMES_ADJUST__'", '"{}"')
    .replace("'__PRAY_TIMES_TUNE__'", '"{}"')
    .replace(/__DB_JSON__/g, JSON.stringify(JSON.stringify(db)))

  const state = { visible: {}, calls: [], posts: [], texts: {}, found: [], reflows: [] }
  const $ = makeJquery(state)
  const fakeDocument = { getElementById: () => null }
  class FakeEventSource { constructor() {} addEventListener() {} }
  class FakeAudio { constructor() { this.currentTime = 0 } play() { return Promise.resolve() } pause() {} }
  const prayTimesStub = {
    adjust() {}, tune() {},
    getTimes: () => ({
      ...REAL_TIMES,
      ...(process.env.UJI_JAM ? { [REAL_PRAYER]: process.env.UJI_JAM } : {})
    })
  }
  const run = new Function(
    '$', 'moment', 'EventSource', 'Audio', 'document', 'prayTimes', 'console',
    code + '\n;return app;'
  )
  const app = run($, moment, FakeEventSource, FakeAudio, fakeDocument, prayTimesStub, console)
  return { app, state }
}

afterEach(() => { vi.useRealTimers() })

const UJI_AKTIF = Boolean(process.env.UJI_MODE || process.env.UJI_JAM)

describe.skipIf(!UJI_AKTIF)(`uji waktu sholat: ${REAL_PRAYER} -${REAL_MENIT} menit (mode=${UJI_MODE})`, () => {
  it('pipeline Menuju → Adzan → (Iqomah | langsung utama di Jumat Dzuhur)', async () => {
    const urutan = []
    let terakhir = null
    const catat = (fase, jam) => {
      if (fase !== terakhir) { urutan.push({ t: jam, fase }); terakhir = fase }
    }

    // Sim mode: UJI_JAM must match SIM_PRAYER_TIMES[REAL_PRAYER] (the schedule
    // the app actually sees). A mismatch means no phase is observed at all.
    if (UJI_MODE === 'sim' && process.env.UJI_JAM) {
      const jadwalSim = SIM_PRAYER_TIMES[REAL_PRAYER]
      if (process.env.UJI_JAM !== jadwalSim) {
        throw new Error(
          `UJI_JAM=${process.env.UJI_JAM} tidak cocok dengan SIM_PRAYER_TIMES.${REAL_PRAYER}=${jadwalSim}. ` +
          'Simulasikan jadwal yang sama atau biarkan UJI_JAM kosong.'
        )
      }
    }

    // Effective day: sim mode uses UJI_TANGGAL, real mode uses the system clock.
    // Friday Dhuhr = straight back to main after the adhan (no iqomah/khutbah).
    const tanggalDasar = process.env.UJI_TANGGAL || '2026-08-29'
    const hariJumat = UJI_MODE === 'sim'
      ? moment(tanggalDasar.slice(0, 10)).format('dddd') === 'Friday'
      : moment().format('dddd') === 'Friday'
    const jumatDzuhur = hariJumat && REAL_PRAYER === 'dhuhr'

    if (UJI_MODE === 'sim') await jalankanSimulasi(catat)
    else await jalankanReal(catat)

    console.log('urutan fase:', JSON.stringify(urutan, null, 2))
    const faseTeramati = urutan.map((u) => u.fase)
    expect(faseTeramati).toContain('MENUJU')
    expect(faseTeramati).toContain('ADZAN')
    expect(faseTeramati.indexOf('MENUJU')).toBeLessThan(faseTeramati.indexOf('ADZAN'))
    if (jumatDzuhur) {
      expect(faseTeramati).not.toContain('IQOMAH')
      // After the adhan it must return to main (null phase) and stay stable
      expect(faseTeramati[faseTeramati.length - 1]).toBe(null)
    } else {
      expect(faseTeramati).toContain('IQOMAH')
    }
  }, 9 * 60 * 60 * 1000)

  async function jalankanReal(catat) {
    const jamSholat = process.env.UJI_JAM || REAL_TIMES[REAL_PRAYER]
    const target = moment(jamSholat, 'HH:mm')
    const mulai = target.clone().subtract(REAL_MENIT * 60 + 10, 'seconds')
    const akhirFase = 3 * 60 + 10 * 60
    const sampai = target.clone().add(akhirFase + 20, 'seconds')

    const delayMs = mulai.diff(moment())
    if (delayMs > 0) {
      console.log(`menunggu jendela: ${Math.round(delayMs / 1000)} detik lagi`)
      await sleep(delayMs)
    }

    const { state } = buildApp()
    while (moment().isBefore(sampai)) {
      catat(overlayPhase(state), moment().format('HH:mm:ss'))
      await sleep(1000)
    }
  }

  async function jalankanSimulasi(catat) {
    // The sim schedule MUST match the bootApp stub (SIM_PRAYER_TIMES) — otherwise
    // the simulation starts outside the window and no phase is ever observed (old bug).
    const targetJam = process.env.UJI_JAM || SIM_PRAYER_TIMES[REAL_PRAYER]
    // Default date: a weekday (not Friday) so the normal iqomah path is covered
    const tanggalDasar = process.env.UJI_TANGGAL || '2026-08-29'
    const mulai = moment(`${tanggalDasar.slice(0, 10)}T${targetJam}:00`)
      .subtract(REAL_MENIT * 60 + 30, 'seconds')

    const db = baseDb({ timer: { wait_adzan: REAL_MENIT, adzan: 3 } })
    const { state } = bootApp(db, mulai.toISOString())

    // Safety margin: pre-adhan + adhan + 10m iqomah + buffer
    const totalDetik = (REAL_MENIT + 3 + 10) * 60 + 60
    let mainStabil = 0
    for (let i = 0; i < totalDetik; i++) {
      vi.advanceTimersByTime(1000)
      const fase = overlayPhase(state)
      catat(fase, moment().format('HH:mm:ss'))
      if (!fase && i > REAL_MENIT * 60) mainStabil++
      if (mainStabil >= 45) break
    }
  }
})
