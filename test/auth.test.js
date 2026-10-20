import { describe, it, expect } from 'vitest'
import { createSessionToken, verifySessionToken, getCookie, sessionSetCookie, sessionClearCookie } from '../src/lib/auth.js'

describe('auth', () => {
  it('valid token verifies and returns user', async () => {
    const token = await createSessionToken('secret', 'admin')
    expect(await verifySessionToken('secret', token)).toBe('admin')
  })

  it('wrong secret rejects token', async () => {
    const token = await createSessionToken('secret-a', 'admin')
    expect(await verifySessionToken('secret-b', token)).toBeNull()
  })

  it('tampered token rejects', async () => {
    const token = await createSessionToken('secret', 'admin')
    const tampered = token.slice(0, -2) + 'xx'
    expect(await verifySessionToken('secret', tampered)).toBeNull()
  })

  it('malformed token returns null without throwing', async () => {
    expect(await verifySessionToken('secret', 'garbage')).toBeNull()
    expect(await verifySessionToken('secret', '')).toBeNull()
    expect(await verifySessionToken('secret', null)).toBeNull()
  })

  it('getCookie extracts named cookie', () => {
    const req = new Request('https://x.test/', {
      headers: { Cookie: 'a=1; dm_session=abc; b=2' }
    })
    expect(getCookie(req, 'dm_session')).toBe('abc')
    expect(getCookie(req, 'missing')).toBeNull()
  })

  it('session cookie memakai flag keamanan penuh pada https', () => {
    const req = new Request('https://jam.example/api/proses')
    const set = sessionSetCookie('token-x', req)
    expect(set).toContain('HttpOnly')
    expect(set).toContain('Secure')
    expect(set).toContain('SameSite=Lax')
    const clear = sessionClearCookie(req)
    expect(clear).toContain('Secure')
    expect(clear).toContain('Max-Age=0')
  })

  it('cookie tanpa Secure pada http LAN agar sesi admin tidak hilang', () => {
    const req = new Request('http://192.168.1.10:11111/api/proses')
    const set = sessionSetCookie('token-x', req)
    expect(set).not.toContain('Secure')
    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Lax')
    expect(sessionClearCookie(req)).not.toContain('Secure')
  })

  it('tanpa request (default aman) tetap pasang Secure', () => {
    expect(sessionSetCookie('token-x')).toContain('Secure')
    expect(sessionClearCookie()).toContain('Secure')
  })
})
