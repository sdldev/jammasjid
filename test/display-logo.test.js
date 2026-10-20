// Logo display tests: img kiri/kanan tampil/sembunyi sesuai db.logo,
// plus mode posisi 'above_clock' (satu logo di atas jam, kiri > kanan).
// Kondisi: tanpa logo, kiri saja, kanan saja, dua-duanya (fitur opsional).
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

describe('logo opsional kiri/kanan judul', () => {
  it('tanpa konfigurasi logo → kedua img tersembunyi, src kosong', () => {
    const { state } = bootApp(baseDb(), '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(false)
    expect(state.visible['#logo-right']).toBe(false)
    expect(state.visible['#logo-top']).toBe(false)
  })

  it('db lama tanpa key logo sama sekali → tidak error, tersembunyi', () => {
    const db = baseDb()
    delete db.logo
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(false)
    expect(state.visible['#logo-right']).toBe(false)
  })

  it('logo kiri terisi → #logo-left tampil dengan src, kanan tersembunyi', () => {
    const db = baseDb({ logo: { left: '/img/logo-left.webp?v=123', right: '' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(true)
    expect(state.attrs['#logo-left'].src).toBe('/img/logo-left.webp?v=123')
    expect(state.visible['#logo-right']).toBe(false)
  })

  it('logo kanan terisi → hanya #logo-right tampil', () => {
    const db = baseDb({ logo: { left: '', right: '/logo/right?v=456' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(false)
    expect(state.visible['#logo-right']).toBe(true)
    expect(state.attrs['#logo-right'].src).toBe('/logo/right?v=456')
  })

  it('kedua logo terisi → keduanya tampil', () => {
    const db = baseDb({ logo: { left: '/img/logo-left.png?v=1', right: '/img/logo-right.png?v=2' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(true)
    expect(state.visible['#logo-right']).toBe(true)
  })

  it('hapus logo (reload db tanpa logo) → src di-remove bukan dibiarkan', () => {
    // boot dengan logo, lalu panggil showLogo dengan db kosong (simulasi kebalikan)
    const db = baseDb({ logo: { left: '/img/logo-left.webp?v=123', right: '' } })
    const { app, state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(true)
    app.db.logo = { left: '', right: '' }
    app.showLogo()
    expect(state.visible['#logo-left']).toBe(false)
    expect(state.attrs['#logo-left'].src).toBeUndefined()
  })
})

describe('logo posisi above_clock (satu logo di atas jam)', () => {
  it('kiri terisi → #logo-top tampil dengan src kiri, samping nama tersembunyi', () => {
    const db = baseDb({ logo: { left: '/img/logo-left.png?v=1', right: '/img/logo-right.png?v=2', position: 'above_clock' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-top']).toBe(true)
    expect(state.attrs['#logo-top'].src).toBe('/img/logo-left.png?v=1')
    expect(state.visible['#logo-left']).toBe(false)
    expect(state.visible['#logo-right']).toBe(false)
  })

  it('kiri kosong, kanan terisi → #logo-top pakai src kanan', () => {
    const db = baseDb({ logo: { left: '', right: '/logo/right?v=9', position: 'above_clock' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-top']).toBe(true)
    expect(state.attrs['#logo-top'].src).toBe('/logo/right?v=9')
  })

  it('tidak ada logo → #logo-top tersembunyi walau mode above_clock', () => {
    const db = baseDb({ logo: { left: '', right: '', position: 'above_clock' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-top']).toBe(false)
  })

  it('position tak dikenal/undefined (db lama) → perilaku default samping nama', () => {
    const db = baseDb({ logo: { left: '/img/logo-left.png?v=1', right: '' } })
    const { state } = bootApp(db, '2026-10-18T10:00:00')
    expect(state.visible['#logo-left']).toBe(true)
    expect(state.visible['#logo-top']).toBe(false)
  })
})
