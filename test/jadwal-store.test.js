// jadwalStore tests: a single jadwal-sholat.json file, stale-date pruning,
// and legacy migration from database.json.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileJadwalStore, migrateLegacyJadwal, buangUsang } from '../src/lib/jadwalStore.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jadwal-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const hariIni = new Date().toISOString().slice(0, 10)
const besok = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const sebulan = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

const SAMPLE = {
  [hariIni]: { fajr: '04:14', sunrise: '05:27', dhuhr: '11:41', asr: '14:47', maghrib: '17:48', isha: '18:58' },
  [besok]: { fajr: '04:09', sunrise: '05:23', dhuhr: '11:39', asr: '14:54', maghrib: '17:49', isha: '19:00' },
  [sebulan]: { fajr: '04:30', sunrise: '05:45', dhuhr: '12:00', asr: '15:10', maghrib: '18:10', isha: '19:20' }
}

describe('createFileJadwalStore', () => {
  it('menyimpan ke satu file jadwal-sholat.json dan memuat utuh', async () => {
    const store = createFileJadwalStore(dir)
    await store.save(SAMPLE)
    expect(existsSync(join(dir, 'jadwal-sholat.json'))).toBe(true)
    expect(await store.load()).toEqual(SAMPLE)
  })

  it('load pada file kosong/korup tidak melempar error', async () => {
    const store = createFileJadwalStore(join(dir, 'belum-ada'))
    expect(await store.load()).toEqual({})
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'jadwal-sholat.json'), '{korup!')
    expect(await createFileJadwalStore(dir).load()).toEqual({})
  })

  it('save membuang tanggal usang (< hari ini) — window bergulir', async () => {
    const store = createFileJadwalStore(dir)
    await store.save({
      ...SAMPLE,
      '2020-01-01': { fajr: '05:00' }
    })
    const loaded = await store.load()
    expect(loaded[hariIni]).toBeTruthy()
    expect(loaded[besok]).toBeTruthy()
    expect(loaded['2020-01-01']).toBeUndefined()
  })

  it('save menimpa isi lama (bukan menambah)', async () => {
    const store = createFileJadwalStore(dir)
    await store.save(SAMPLE)
    await store.save({ [hariIni]: { fajr: '04:20' } })
    const loaded = await store.load()
    expect(Object.keys(loaded)).toEqual([hariIni])
  })
})

describe('buangUsang', () => {
  it('mengembalikan hanya tanggal >= hari ini', () => {
    const out = buangUsang({
      '2020-01-01': { fajr: 'x' },
      [hariIni]: { fajr: 'y' },
      [besok]: { fajr: 'z' }
    })
    expect(Object.keys(out).sort()).toEqual([besok, hariIni].sort())
  })
})

describe('migrateLegacyJadwal', () => {
  it('memindahkan jadwal_resmi inline ke store dan menghapusnya dari dokumen', async () => {
    const store = createFileJadwalStore(dir)
    const db = { setting: { nama: 'X' }, jadwal_resmi: SAMPLE }
    expect(await migrateLegacyJadwal(store, db)).toBe(true)
    expect(db.jadwal_resmi).toBeUndefined()
    expect(await store.load()).toEqual(SAMPLE)
  })

  it('no-op bila tidak ada jadwal legacy', async () => {
    const store = createFileJadwalStore(dir)
    const db = { setting: { nama: 'X' } }
    expect(await migrateLegacyJadwal(store, db)).toBe(false)
    expect(await migrateLegacyJadwal(store, { jadwal_resmi: {} })).toBe(false)
  })
})
