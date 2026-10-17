// Offline & net-banner behavior: checkDbChange fail must mark the display offline,
// and the wrong-clock banner must appear at boot when time_offset_ms is large.
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { bootApp, baseDb } from './display-harness.js'

afterEach(() => { vi.useRealTimers() })

describe('jalur offline display', () => {
  it('checkDbChange fail → net-status offline, banner merah, jam merah', () => {
    const { app, state } = bootApp(baseDb(), '2026-08-29T10:00:00')

    // The display issues the first changeDbCheck at boot
    expect(state.posts).toContain('/api/proses')
    expect(state.lastAjaxFail).toBeTypeOf('function')

    // Simulate network/server failure
    state.lastAjaxFail()

    expect(state.classes['#net-status']?.has('offline')).toBe(true)
    expect(state.classes['#jam']?.has('clock-offline')).toBe(true)
    expect(state.texts['#net-banner']).toBe('Tidak ada koneksi internet')
    expect(state.visible['#net-banner']).toBe(true)
  })

  it('updateNetBanner(true) dengan offset >= 1 jam → banner oranye saat boot', () => {
    const db = baseDb({ time_offset_ms: 2 * 60 * 60 * 1000 })
    const { state } = bootApp(db, '2026-08-29T10:00:00')

    expect(state.texts['#net-banner']).toBe('Jam perangkat salah, sudah dikoreksi otomatis')
    expect(state.visible['#net-banner']).toBe(true)
  })
})
