// LogoUpload handler tests: validasi ditolak, upload sukses menyimpan file +
// URL versi ke db.logo[side], remove mengosongkan, dan notifyHub terpanggil
// (kontrak mutasi wajib — display harus reload via SSE).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleProses } from '../src/lib/proses.js'
import { createFileLogoStore } from '../src/lib/logoStore.js'
import { makeEnv, makeHubStub } from './helpers.js'
import { createSessionToken, COOKIE_NAME } from '../src/lib/auth.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jm-logo-up-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function envDenganLogo() {
  const env = makeEnv({ hub: makeHubStub() })
  env.LOGO_STORE = createFileLogoStore(dir)
  return env
}

// Request multipart dengan file palsu (Web API File standar)
function uploadRequest(side, { type = 'image/png', bytes = 1024, name = 'logo.png' } = {}) {
  const form = new FormData()
  form.append('side', side)
  form.append('file', new File([new Uint8Array(bytes)], name, { type }))
  return new Request('http://x/api/proses', { method: 'POST', body: form })
}

async function authedRequest(request, secret) {
  const token = await createSessionToken(secret, 'op')
  const headers = new Headers(request.headers)
  headers.set('Cookie', `${COOKIE_NAME}=${token}`)
  return new Request(request.url, { method: 'POST', headers, body: request.body, duplex: 'half' })
}

async function removeRequest(secret) {
  const token = await createSessionToken(secret, 'op')
  return new Request('http://x/api/proses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `${COOKIE_NAME}=${token}` },
    body: 'id=logoRemove&dt[side]=left'
  })
}

describe('logoUpload', () => {
  it('upload sukses: file tersimpan, db.logo terisi URL versi, notifyHub terpanggil', async () => {
    const env = envDenganLogo()
    const req = await authedRequest(uploadRequest('left'), env.AUTH_SECRET)
    const res = await handleProses(req, env)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.url).toMatch(/\/img\/logo-left\.png\?v=\d+/)
    expect(existsSync(join(dir, 'logo-left.png'))).toBe(true)
    expect(env.HUB.calls).toContain('notify')

    const raw = JSON.parse(env.DATABASE._store.get('database'))
    expect(raw.logo.left).toBe(body.data.url)
    expect(raw.logo.right).toBe('') // sisi lain tak tersentuh
  })

  it('tipe tidak diizinkan ditolak', async () => {
    const env = envDenganLogo()
    // Konten dengan header non-image (mis. PDF %PDF-) agar runtime tidak
    // me-retype File via sniffing magic bytes menjadi image/*.
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(1000).fill(1)])
    const form = new FormData()
    form.append('side', 'left')
    form.append('file', new File([pdfBytes], 'logo.pdf', { type: 'application/pdf' }))
    const req0 = new Request('http://x/api/proses', { method: 'POST', body: form })
    const req = await authedRequest(req0, env.AUTH_SECRET)
    const body = await (await handleProses(req, env)).json()
    expect(body.success).toBe(false)
    expect(body.data).toMatch(/PNG|JPG/)
  })

  it('upload WebP ditolak (hanya JPEG dan PNG)', async () => {
    const env = envDenganLogo()
    const req = await authedRequest(uploadRequest('left', { type: 'image/webp', name: 'logo.webp' }), env.AUTH_SECRET)
    const body = await (await handleProses(req, env)).json()
    expect(body.success).toBe(false)
    expect(body.data).toMatch(/PNG|JPG/)
    // tidak ada file tersimpan
    expect(existsSync(join(dir, 'logo-left.webp'))).toBe(false)
  })

  it('ukuran > 4MB ditolak', async () => {
    const env = envDenganLogo()
    const req = await authedRequest(uploadRequest('left', { bytes: 5 * 1024 * 1024 }), env.AUTH_SECRET)
    const body = await (await handleProses(req, env)).json()
    expect(body.success).toBe(false)
    expect(body.data).toMatch(/4 MB/)
  })

  it('file 2MB (di bawah batas 4MB) diterima', async () => {
    const env = envDenganLogo()
    const req = await authedRequest(uploadRequest('left', { bytes: 2 * 1024 * 1024 }), env.AUTH_SECRET)
    const body = await (await handleProses(req, env)).json()
    expect(body.success).toBe(true)
  })

  it('sisi tidak valid ditolak', async () => {
    const env = envDenganLogo()
    const req = await authedRequest(uploadRequest('atas'), env.AUTH_SECRET)
    const body = await (await handleProses(req, env)).json()
    expect(body.success).toBe(false)
  })

  it('tanpa login ditolak (registered false)', async () => {
    const env = envDenganLogo()
    const res = await handleProses(uploadRequest('left'), env)
    const body = await res.json()
    expect(body.registered).toBe(false)
  })
})

describe('logoRemove', () => {
  it('mengosongkan db.logo[side] dan notifyHub terpanggil', async () => {
    const env = envDenganLogo()
    // isi dulu
    const up = await authedRequest(uploadRequest('left'), env.AUTH_SECRET)
    await handleProses(up, env)
    expect(env.HUB.calls).toContain('notify')

    // hapus
    const res = await handleProses(await removeRequest(env.AUTH_SECRET), env)
    const body = await res.json()
    expect(body.success).toBe(true)

    const raw = JSON.parse(env.DATABASE._store.get('database'))
    expect(raw.logo.left).toBe('')
  })
})
