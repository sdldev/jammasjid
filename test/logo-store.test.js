// LogoStore tests: file backend (atomic write, ekstensi bersih), KV backend
// (base64 round-trip), storeFromEnv prioritas, dan validasi tipe/ukuran.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFileLogoStore, createKvLogoStore, storeFromEnv,
  validateLogoFile, LOGO_SIDES
} from '../src/lib/logoStore.js'

describe('validateLogoFile', () => {
  it('menerima PNG/JPEG dengan ukuran wajar', () => {
    expect(validateLogoFile({ contentType: 'image/png', size: 1024 })).toEqual({ ext: 'png' })
    expect(validateLogoFile({ contentType: 'image/jpeg', size: 1024 })).toEqual({ ext: 'jpg' })
  })
  it('menolak tipe lain', () => {
    expect(validateLogoFile({ contentType: 'image/gif', size: 1024 }).error).toBeTruthy()
    expect(validateLogoFile({ contentType: 'image/webp', size: 1024 }).error).toBeTruthy()
    expect(validateLogoFile({ contentType: 'application/pdf', size: 1024 }).error).toBeTruthy()
    expect(validateLogoFile({ contentType: '', size: 1024 }).error).toBeTruthy()
  })
  it('menolak ukuran 0 / > 500KB', () => {
    expect(validateLogoFile({ contentType: 'image/png', size: 0 }).error).toBeTruthy()
    expect(validateLogoFile({ contentType: 'image/png', size: 5 * 1024 * 1024 }).error).toBeTruthy()
  })
})

describe('createFileLogoStore', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jm-logo-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('save menulis file logo-{side}.{ext} dan URL mengandung versi', async () => {
    const store = createFileLogoStore(dir)
    await store.save('left', new Uint8Array([1, 2, 3]), 'png')
    const file = join(dir, 'logo-left.png')
    expect(existsSync(file)).toBe(true)
    expect([...readFileSync(file)]).toEqual([1, 2, 3])
    const url = store.urlFor('left', 'png', 12345)
    expect(url).toBe('/img/logo-left.png?v=12345')
  })

  it('save dengan ekstensi baru membersihkan file ekstensi lama', async () => {
    const store = createFileLogoStore(dir)
    await store.save('right', new Uint8Array([1]), 'png')
    expect(existsSync(join(dir, 'logo-right.png'))).toBe(true)
    await store.save('right', new Uint8Array([1]), 'jpg')
    expect(existsSync(join(dir, 'logo-right.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'logo-right.png'))).toBe(false)
  })

  it('remove menghapus semua varian ekstensi sisi itu saja', async () => {
    const store = createFileLogoStore(dir)
    await store.save('left', new Uint8Array([1]), 'png')
    await store.save('right', new Uint8Array([1]), 'png')
    await store.remove('left')
    expect(existsSync(join(dir, 'logo-left.png'))).toBe(false)
    expect(existsSync(join(dir, 'logo-right.png'))).toBe(true)
  })
})

describe('createKvLogoStore', () => {
  const kvStub = () => {
    const m = new Map()
    return {
      async put(k, v) { m.set(k, v) },
      // Antarmuka KV asli: type 'json' → nilai terparse
      async get(k, type) {
        if (!m.has(k)) return null
        return type === 'json' ? JSON.parse(m.get(k)) : m.get(k)
      },
      async delete(k) { m.delete(k) },
      _map: m
    }
  }

  it('save/load round-trip base64 + contentType', async () => {
    const kv = kvStub()
    const store = createKvLogoStore(kv)
    await store.save('left', new Uint8Array([10, 20, 30]), 'png')
    const loaded = await store.load('left')
    expect([...loaded.buffer]).toEqual([10, 20, 30])
    expect(loaded.contentType).toBe('image/png')
    expect(store.urlFor('left', 'png', 99)).toBe('/logo/left?v=99')
  })

  it('load mengembalikan null bila tidak ada, remove menghapus', async () => {
    const kv = kvStub()
    const store = createKvLogoStore(kv)
    expect(await store.load('right')).toBe(null)
    await store.save('right', new Uint8Array([1]), 'jpg')
    await store.remove('right')
    expect(await store.load('right')).toBe(null)
  })
})

describe('storeFromEnv', () => {
  it('LOGO_STORE menang atas DATABASE (prioritas adapter lokal)', () => {
    const custom = { backend: 'file' }
    expect(storeFromEnv({ LOGO_STORE: custom, DATABASE: {} })).toBe(custom)
  })
  it('fallback ke KV store dari DATABASE', () => {
    const store = storeFromEnv({ DATABASE: {} })
    expect(store.backend).toBe('kv')
  })
  it('null bila tidak ada keduanya', () => {
    expect(storeFromEnv({})).toBe(null)
  })
})

describe('LOGO_SIDES', () => {
  it('hanya left dan right', () => {
    expect(LOGO_SIDES).toEqual(['left', 'right'])
  })
})
