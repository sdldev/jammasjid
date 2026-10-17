// Keamanan password admin untuk repo publik:
// - Password TIDAK disimpan di db/database.json (sumbernya env.ADMIN_PASS)
// - Login DITOLAK selama masih password default admin1234
// - Setelah diganti lewat menu admin, login memakai nilai baru
import { describe, it, expect, beforeEach } from 'vitest'
import { handleProses } from '../src/lib/proses.js'
import { DEFAULT_DB, DEFAULT_ADMIN_PASS, adminPassword, mustChangePass } from '../src/lib/db.js'
import { makeEnv } from './helpers.js'

function post(body, cookie = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  return new Request('https://x.test/api/proses', {
    method: 'POST', headers, body: JSON.stringify(body)
  })
}

async function login(env, pass) {
  const res = await handleProses(post({ id: 'login', dt: { user: DEFAULT_DB.akses.user, pass } }), env)
  return { body: await res.json(), cookie: (res.headers.get('Set-Cookie') || '').split(';')[0] }
}

describe('password admin dari env (repo publik)', () => {
  it('DEFAULT_DB tidak mengandung password', () => {
    expect(DEFAULT_DB.akses.pass).toBe('')
    expect(DEFAULT_ADMIN_PASS).toBe('admin1234')
  })

  it('adminPassword memakai db.akses.pass bila terisi, selain itu env', () => {
    expect(adminPassword({ ADMIN_PASS: 'x' }, { akses: { pass: 'stored' } })).toBe('stored')
    expect(adminPassword({ ADMIN_PASS: 'x' }, { akses: { pass: '' } })).toBe('x')
    expect(adminPassword({}, { akses: { pass: '' } })).toBe('admin1234')
  })

  it('mustChangePass true selama password masih default', () => {
    expect(mustChangePass({}, { akses: { pass: '' } })).toBe(true)
    expect(mustChangePass({ ADMIN_PASS: 'admin1234' }, { akses: { pass: '' } })).toBe(true)
    expect(mustChangePass({ ADMIN_PASS: 'kuat12345' }, { akses: { pass: '' } })).toBe(false)
  })

  it('login DITOLAK bila password masih default admin1234', async () => {
    const env = makeEnv({ adminPass: 'admin1234' })
    const r = await login(env, 'admin1234')
    expect(r.body.success).toBe(false)
    expect(r.body.data).toMatch(/password default/i)
    expect(r.cookie).toBe('') // tidak ada sesi
  })

  it('login berhasil dengan ADMIN_PASS non-default', async () => {
    const env = makeEnv({ adminPass: 'kuat12345' })
    const r = await login(env, 'kuat12345')
    expect(r.body.success).toBe(true)
    expect(r.cookie).toContain('dm_session=')
  })

  it('setelah ganti password, login memakai nilai baru (env tidak lagi dipakai)', async () => {
    const env = makeEnv({ adminPass: 'awal12345' })
    const first = await login(env, 'awal12345')
    const res = await handleProses(post({
      id: 'formSave',
      dt: { formId: 'gantiPass', index: 'no-index', password_lama: 'awal12345', password_baru: 'baru12345', ulangi_password_baru: 'baru12345' }
    }, first.cookie), env)
    expect((await res.json()).success).toBe(true)

    // password lama (env) tidak berlaku lagi, password baru berlaku
    expect((await login(env, 'awal12345')).body.success).toBe(false)
    expect((await login(env, 'baru12345')).body.success).toBe(true)
  })

  it('menolak mengganti password menjadi admin1234', async () => {
    const env = makeEnv({ adminPass: 'awal12345' })
    const first = await login(env, 'awal12345')
    const res = await handleProses(post({
      id: 'formSave',
      dt: { formId: 'gantiPass', index: 'no-index', password_lama: 'awal12345', password_baru: 'admin1234', ulangi_password_baru: 'admin1234' }
    }, first.cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toMatch(/default admin1234/i)
  })
})
