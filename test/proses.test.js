import { describe, it, expect, beforeEach } from 'vitest'
import { handleProses } from '../src/lib/proses.js'
import { DEFAULT_DB } from '../src/lib/db.js'
import { makeEnv } from './helpers.js'

function post(body, cookie = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  return new Request('https://x.test/api/proses', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
}

async function login(env) {
  const res = await handleProses(post({ id: 'login', dt: { user: DEFAULT_DB.akses.user, pass: env.ADMIN_PASS } }), env)
  const setCookie = res.headers.get('Set-Cookie')
  return setCookie.split(';')[0] // dm_session=...
}

describe('proses API - kontrak respons', () => {
  let env

  beforeEach(() => {
    env = makeEnv()
  })

  it('permintaan tanpa login → registered:false', async () => {
    const res = await handleProses(post({ id: 'readDatabase' }), env)
    expect(await res.json()).toEqual({ success: true, registered: false, data: null })
  })

  it('id tidak dikenal + belum login → registered:false', async () => {
    const res = await handleProses(post({ id: 'bukanHandler' }), env)
    const body = await res.json()
    expect(body.registered).toBe(false)
  })

  it('id tidak dikenal + sudah login → success:false', async () => {
    const cookie = await login(env)
    const res = await handleProses(post({ id: 'bukanHandler' }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toBe('Request tidak ditemukan...')
  })

  it('changeDbCheck tanpa login boleh (public)', async () => {
    const res = await handleProses(post({ id: 'changeDbCheck' }), env)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toMatch(/^[0-9a-f]{40}\d+$/)
  })
})

describe('proses API - login/logout', () => {
  it('login sukses set cookie', async () => {
    const env = makeEnv()
    const res = await handleProses(post({ id: 'login', dt: { user: DEFAULT_DB.akses.user, pass: env.ADMIN_PASS } }), env)
    expect(res.headers.get('Set-Cookie')).toContain('dm_session=')
    expect((await res.json()).success).toBe(true)
  })

  it('login password salah', async () => {
    const env = makeEnv()
    const res = await handleProses(post({ id: 'login', dt: { user: DEFAULT_DB.akses.user, pass: 'salah' } }), env)
    expect(await res.json()).toEqual({ success: false, registered: true, data: 'Anda tidak memiliki akses...' })
  })

  it('login tanpa data', async () => {
    const env = makeEnv()
    const res = await handleProses(post({ id: 'login' }), env)
    expect((await res.json()).data).toBe('Data tidak valid...')
  })

  it('logout menghapus session', async () => {
    const env = makeEnv()
    const cookie = await login(env)
    const res = await handleProses(post({ id: 'logout' }, cookie), env)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect((await res.json()).registered).toBe(false)
    // After logout the browser has no cookie → requests without a cookie are rejected
    const res2 = await handleProses(post({ id: 'readDatabase' }), env)
    expect((await res2.json()).registered).toBe(false)
  })
})

describe('proses API - formSave', () => {
  let env, cookie

  beforeEach(async () => {
    env = makeEnv()
    cookie = await login(env)
  })

  const savedDb = async () => JSON.parse(env.DATABASE._store.get('database'))

  it('simpan running_text baru (index "new")', async () => {
    const res = await handleProses(
      post({ id: 'formSave', dt: { formId: 'running_text', index: 'new', text: 'Teks baru' } }, cookie),
      env
    )
    expect((await res.json()).success).toBe(true)
    const db = await savedDb()
    expect(db.running_text).toContain('Teks baru')
    expect(env.HUB.calls).toContain('notify')
  })

  it('update running_text by index', async () => {
    await handleProses(
      post({ id: 'formSave', dt: { formId: 'running_text', index: '0', text: 'Diubah' } }, cookie),
      env
    )
    const db = await savedDb()
    expect(db.running_text[0]).toBe('Diubah')
    expect(db.running_text.length).toBe(DEFAULT_DB.running_text.length)
  })

  it('simpan setting via no-index (merge)', async () => {
    await handleProses(
      post({ id: 'formSave', dt: { formId: 'setting', index: 'no-index', nama: 'Masjid Baru' } }, cookie),
      env
    )
    const db = await savedDb()
    expect(db.setting.nama).toBe('Masjid Baru')
    expect(db.setting.lokasi).toBe(DEFAULT_DB.setting.lokasi) // field lain tetap
  })

  it('simpan prayTimesAdjust memindah method ke prayTimesMethod', async () => {
    await handleProses(
      post({ id: 'formSave', dt: { formId: 'prayTimesAdjust', index: 'no-index', prayTimesMethod: 'MWL', fajr: '18' } }, cookie),
      env
    )
    const db = await savedDb()
    expect(db.prayTimesMethod).toBe('MWL')
    expect(db.prayTimesAdjust.fajr).toBe('18')
    expect(db.prayTimesAdjust.prayTimesMethod).toBeUndefined()
  })

  it('gantiPass: password lama salah', async () => {
    const res = await handleProses(
      post({ id: 'formSave', dt: { formId: 'gantiPass', index: 'no-index', password_lama: 'x', password_baru: 'rahasia123', ulangi_password_baru: 'rahasia123' } }, cookie),
      env
    )
    expect((await res.json()).data).toBe('Password lama salah...')
  })

  it('gantiPass: password baru tidak sama', async () => {
    const res = await handleProses(
      post({ id: 'formSave', dt: { formId: 'gantiPass', index: 'no-index', password_lama: env.ADMIN_PASS, password_baru: 'rahasia123', ulangi_password_baru: 'beda' } }, cookie),
      env
    )
    expect((await res.json()).data).toBe('Password baru tidak sama...')
  })

  it('gantiPass: terlalu pendek', async () => {
    const res = await handleProses(
      post({ id: 'formSave', dt: { formId: 'gantiPass', index: 'no-index', password_lama: env.ADMIN_PASS, password_baru: 'pendek', ulangi_password_baru: 'pendek' } }, cookie),
      env
    )
    expect((await res.json()).data).toBe('Password terlalu pendek, minimal 8 karakter...')
  })

  it('gantiPass sukses mengubah akses.pass', async () => {
    const res = await handleProses(
      post({ id: 'formSave', dt: { formId: 'gantiPass', index: 'no-index', password_lama: env.ADMIN_PASS, password_baru: 'rahasia123', ulangi_password_baru: 'rahasia123' } }, cookie),
      env
    )
    expect((await res.json()).success).toBe(true)
    const db = await savedDb()
    expect(db.akses.pass).toBe('rahasia123')
  })
})

describe('proses API - formDelete & reset', () => {
  let env, cookie

  beforeEach(async () => {
    env = makeEnv()
    cookie = await login(env)
  })

  it('formDelete hapus item dan re-index', async () => {
    const res = await handleProses(
      post({ id: 'formDelete', dt: { formId: 'running_text', index: '0' } }, cookie),
      env
    )
    expect((await res.json()).success).toBe(true)
    const db = JSON.parse(env.DATABASE._store.get('database'))
    expect(db.running_text.length).toBe(DEFAULT_DB.running_text.length - 1)
    expect(db.running_text).toEqual(DEFAULT_DB.running_text.slice(1))
  })

  it('formDelete menolak jika sisa < 1', async () => {
    // build a db with only 1 running_text item
    const db = DEFAULT_DB
    const small = { ...db, running_text: ['satu'] }
    await env.DATABASE.put('database', JSON.stringify(small))
    const res = await handleProses(
      post({ id: 'formDelete', dt: { formId: 'running_text', index: '0' } }, cookie),
      env
    )
    expect((await res.json()).data).toBe('Minimal harus ada 1 data...')
  })

  it('resetDevice tanpa konfirmasi ditolak', async () => {
    const res = await handleProses(post({ id: 'resetDevice', dt: 'bukan' }, cookie), env)
    expect((await res.json()).data).toBe('Not confirm...')
  })

  it('resetDevice dengan KONFIRMASI reset db + logout', async () => {
    // change the db first
    await handleProses(
      post({ id: 'formSave', dt: { formId: 'setting', index: 'no-index', nama: 'Ubah' } }, cookie),
      env
    )
    const res = await handleProses(post({ id: 'resetDevice', dt: 'KONFIRMASI' }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.registered).toBe(false)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
    const db = JSON.parse(env.DATABASE._store.get('database'))
    // jadwal_resmi is now stored separately from the config document (jadwalStore),
    // so the written document does not contain it.
    const { jadwal_resmi: _jr, ...expected } = DEFAULT_DB
    expect(db).toEqual(expected)
    expect(env.DATABASE._store.get('database')).not.toContain('jadwal_resmi')
  })

  it('getPraySetting mengembalikan struktur simulasi', async () => {
    const res = await handleProses(post({ id: 'getPraySetting' }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.thead[0]).toBe('Tgl')
    expect(body.data.items).toEqual(Object.keys(DEFAULT_DB.prayName))
    expect(body.data.prayTimesAdjust).toEqual({ fajr: 20, asr: 'Standard', isha: 18 })
  })
})

describe('proses API - body form-urlencoded', () => {
  it('menerima body jQuery-style dt[key]=value', async () => {
    const env = makeEnv()
    const body = `id=login&dt[user]=${encodeURIComponent(DEFAULT_DB.akses.user)}&dt[pass]=${encodeURIComponent(env.ADMIN_PASS)}`
    const req = new Request('https://x.test/api/proses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    })
    const res = await handleProses(req, env)
    expect((await res.json()).success).toBe(true)
    expect(res.headers.get('Set-Cookie')).toContain('dm_session=')
  })
})

describe('proses API - updateSystem / updateStatus', () => {
  let env, cookie

  beforeEach(async () => {
    env = makeEnv()
    cookie = await login(env)
  })

  it('updateSystem di env tanpa LOCAL_UPDATE (Workers) → fail lokal-only', async () => {
    const res = await handleProses(post({ id: 'updateSystem' }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toBe('Fitur update hanya tersedia pada mode lokal (STB)')
  })

  it('updateStatus di env tanpa LOCAL_UPDATE → fail lokal-only', async () => {
    const res = await handleProses(post({ id: 'updateStatus' }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toBe('Fitur update hanya tersedia pada mode lokal (STB)')
  })

  it('updateStatus di env lokal mengembalikan status (tanpa menjalankan skrip)', async () => {
    env.LOCAL_UPDATE = true
    const res = await handleProses(post({ id: 'updateStatus' }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('running')
    expect(body.data).toHaveProperty('log')
  })
})

describe('proses API - tailscaleSetup', () => {
  let env, cookie

  beforeEach(async () => {
    env = makeEnv()
    cookie = await login(env)
  })

  it('ditolak di env tanpa LOCAL_UPDATE (Workers) → fail lokal-only', async () => {
    const res = await handleProses(post({ id: 'tailscaleSetup', dt: { emails: 'a@gmail.com' } }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toBe('Fitur Tailscale hanya tersedia pada mode lokal (STB)')
  })

  it('email tidak valid ditolak sebelum menyentuh shell', async () => {
    env.LOCAL_UPDATE = true
    const res = await handleProses(post({ id: 'tailscaleSetup', dt: { emails: 'bukan-email; rm -rf /' } }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toMatch(/Email tidak valid/)
  })

  it('lebih dari 20 email ditolak', async () => {
    env.LOCAL_UPDATE = true
    const banyak = Array.from({ length: 21 }, (_, i) => `p${i}@gmail.com`).join(', ')
    const res = await handleProses(post({ id: 'tailscaleSetup', dt: { emails: banyak } }, cookie), env)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data).toMatch(/Maksimal 20/)
  })

  it('tanpa login → registered:false', async () => {
    const res = await handleProses(post({ id: 'tailscaleSetup', dt: { emails: 'a@gmail.com' } }), env)
    expect((await res.json()).registered).toBe(false)
  })
})

describe('proses API - Quick Tunnel', () => {
  let env, cookie

  beforeEach(async () => {
    env = makeEnv()
    cookie = await login(env)
  })

  for (const id of ['quickTunnelStart', 'quickTunnelStop', 'quickTunnelStatus']) {
    it(`${id} di env tanpa LOCAL_UPDATE (Workers) → fail lokal-only`, async () => {
      const res = await handleProses(post({ id }, cookie), env)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.data).toBe('Quick Tunnel hanya tersedia pada mode lokal (STB)')
    })

    it(`${id} tanpa login → registered:false`, async () => {
      const res = await handleProses(post({ id }), env)
      expect((await res.json()).registered).toBe(false)
    })
  }
})

describe('proses API - Kas Masjid', () => {
  let env, cookie

  beforeEach(async () => {
    env = makeEnv()
    cookie = await login(env)
  })

  it('instal baru memuat section kas dengan bentuk lengkap', async () => {
    const res = await handleProses(post({ id: 'readDatabase' }, cookie), env)
    const body = await res.json()
    expect(body.data.kas).toEqual({ active: true, rekening: '', kas_bulan_lalu: 0, pendapatan: 0, pengeluaran: 0 })
  })

  it('simpan kas via no-index (merge)', async () => {
    await handleProses(
      post({
        id: 'formSave',
        dt: {
          formId: 'kas', index: 'no-index', active: '1',
          rekening: 'BSI 7123456789 a.n. Masjid Jabal Rahmah',
          kas_bulan_lalu: '1500000', pendapatan: '2500000', pengeluaran: '1800000'
        }
      }, cookie),
      env
    )
    const res = await handleProses(post({ id: 'readDatabase' }, cookie), env)
    const kas = (await res.json()).data.kas
    expect(kas.rekening).toBe('BSI 7123456789 a.n. Masjid Jabal Rahmah')
    expect(kas.kas_bulan_lalu).toBe('1500000')
    expect(kas.pendapatan).toBe('2500000')
    expect(kas.pengeluaran).toBe('1800000')
    expect(env.HUB.calls).toContain('notify')
  })

  it('reset device mengembalikan kas ke default', async () => {
    await handleProses(
      post({ id: 'formSave', dt: { formId: 'kas', index: 'no-index', rekening: 'X', kas_bulan_lalu: '999' } }, cookie),
      env
    )
    await handleProses(post({ id: 'resetDevice', dt: 'KONFIRMASI' }, cookie), env)
    const db = JSON.parse(env.DATABASE._store.get('database'))
    expect(db.kas.rekening).toBe('')
    expect(db.kas.kas_bulan_lalu).toBe(0)
  })
})
