// Port of proses.php handlers to a stateless Worker API.
// Response contract kept identical to the PHP original: {success, registered, data}

import {
  DEFAULT_DB, getDb, putDb, hashDb,
  adminPassword, mustChangePass, DEFAULT_ADMIN_PASS
} from './db.js'
import { syncKemenag } from './scheduler.mjs'
import { getSession, getKabkota, getProvinsi } from './kemenag.js'
import { storeFromEnv as logoStoreFromEnv, validateLogoFile, LOGO_SIDES } from './logoStore.js'
import {
  COOKIE_NAME, createSessionToken, verifySessionToken,
  getCookie, sessionSetCookie, sessionClearCookie
} from './auth.js'

const json = (body, extraHeaders = {}) => {
  const ct = 'application/json; charset=utf-8';

  // Universal security headers for API responses
  let headers = {
    'Content-Type': ct,
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };

  if (!body.registered) {
    // Unauthenticated requests → stricter cache control
    headers = {
      'Content-Type': ct,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
  } else if (body.success === false && body.registered) {
    // Failed request but authenticated
    headers = {
      'Content-Type': ct,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
  }

  return new Response(JSON.stringify(body), {
    status: 200,  // Always 200 so jQuery .done() fires
    headers: Object.assign(headers, extraHeaders)
  });
}

const ok = (data = null) => json({ success: true, registered: true, data })
const unregistered = () => json({ success: true, registered: false, data: null })
const fail = (message) => json({ success: false, registered: true, data: message })

// jQuery serializes nested objects as dt[formId]=x & dt[r1]=y — expand bracket keys
function parseFormBody(pairs) {
  const root = {}
  for (const [rawKey, rawValue] of pairs) {
    const path = [...rawKey.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1])
    const head = rawKey.split('[')[0]
    let target = root
    if (path.length > 0) {
      root[head] = root[head] ?? {}
      target = root[head]
    }
    for (let i = 0; i < path.length - 1; i += 1) {
      target[path[i]] = target[path[i]] ?? {}
      target = target[path[i]]
    }
    const leaf = path.length > 0 ? path[path.length - 1] : head
    target[leaf] = rawValue
  }
  return root
}

async function readBody(request) {
  const contentType = request.headers.get('Content-Type') || ''
  if (contentType.includes('application/json')) return request.json()
  // Multipart (upload logo) tidak diparse di sini — handler logoUpload
  // memakai request.formData() langsung agar file tidak disalin dua kali.
  if (contentType.includes('multipart/form-data')) return { id: null, __multipart: true }
  const text = await request.text()
  return parseFormBody(new URLSearchParams(text))
}

async function notifyHub(env) {
  try {
    await env.HUB.get(env.HUB.idFromName('display')).notify()
  } catch {
    // A failed broadcast must never fail the data save
  }
}

// Drop the display page cache so db changes (via dashboard or manual KV
// edits) show up immediately instead of waiting for the 60s max-age.
async function invalidateDisplayCache(origin) {
  try {
    if (!origin || typeof caches === 'undefined' || !caches.default) return
    await caches.default.delete(new URL('/', origin).toString())
  } catch {
    // Invalidation is best-effort; worst case the display refreshes within 60s
  }
}

// --- handlers ---------------------------------------------------------------

async function handleLogin(body, env, request) {
  const user = body.dt?.user || false
  const pass = body.dt?.pass || false
  if (!user || !pass) return fail('Data tidak valid...')
  const db = await getDb(env)

  // Instalasi baru: password masih default → login ditolak sampai operator
  // mengganti password. Ini mencegah admin DEFAULT terbuka di repo publik.
  if (mustChangePass(env, db)) {
    return fail(
      'Password default masih aktif. Ganti dulu ADMIN_PASS di .env (atau ' +
      'secret ADMIN_PASS di Workers) dengan password yang kuat.'
    )
  }

  if (user !== db.akses.user || pass !== adminPassword(env, db)) {
    return fail('Anda tidak memiliki akses...')
  }
  const token = await createSessionToken(env.AUTH_SECRET, user)
  return json({ success: true, registered: true, data: null }, { 'Set-Cookie': sessionSetCookie(token, request) })
}

async function handleLogout(request) {
  return json({ success: true, registered: false, data: null }, { 'Set-Cookie': sessionClearCookie(request) })
}

async function handleChangeDbCheck(env) {
  const db = await getDb(env)
  return ok(await hashDb(db))
}

async function handleReadDatabase(env) {
  return ok(await getDb(env))
}

function applyGantiPass(dt, db, env) {
  // Password lama diverifikasi terhadap password efektif (db tersimpan atau env)
  if (String(dt.password_lama || '') !== adminPassword(env, db)) {
    return { error: 'Password lama salah...' }
  }
  if (dt.password_baru !== dt.ulangi_password_baru) return { error: 'Password baru tidak sama...' }
  if (String(dt.password_baru).length < 8) {
    return { error: 'Password terlalu pendek, minimal 8 karakter...' }
  }
  if (String(dt.password_baru) === DEFAULT_ADMIN_PASS) {
    return { error: 'Jangan gunakan password default admin1234...' }
  }
  return { db: db, formId: 'akses', index: 'pass', value: dt.password_baru }
}

async function handleFormSave(dt, env, origin) {
  const db = await getDb(env)
  let formId = dt.formId
  const index = dt.index
  const { formId: _f, index: _i, ...value } = dt

  let finalValue = value
  if (formId === 'running_text') finalValue = value.text
  else if (formId === 'prayTimesAdjust') {
    db.prayTimesMethod = value.prayTimesMethod
    delete value.prayTimesMethod
    finalValue = value
  } else if (formId === 'gantiPass') {
    const result = applyGantiPass(value, db, env)
    if (result.error) return fail(result.error)
    formId = result.formId
    finalValue = result.value
    db[formId][result.index] = finalValue
    await putDb(env, db)
    await notifyHub(env)
    await invalidateDisplayCache(origin)
    return ok()
  }

  if (index === 'no-index') db[formId] = { ...db[formId], ...finalValue }
  else if (index === 'new') db[formId] = [...db[formId], finalValue]
  else {
    const list = [...db[formId]]
    list[index] = finalValue
    db[formId] = list
  }

  await putDb(env, db)
  await notifyHub(env)
  await invalidateDisplayCache(origin)
  return ok()
}

async function handleFormDelete(dt, env, origin) {
  const db = await getDb(env)
  const list = db[dt.formId]
  if (!Array.isArray(list) || list.length < 2) return fail('Minimal harus ada 1 data...')
  db[dt.formId] = list.filter((_, i) => String(i) !== String(dt.index))
  await putDb(env, db)
  await notifyHub(env)
  await invalidateDisplayCache(origin)
  return ok()
}

async function handleGetPraySetting(env) {
  const db = await getDb(env)
  const data = {
    setting: db.setting,
    prayTimesMethod: db.prayTimesMethod,
    prayTimesAdjust: Object.fromEntries(
      Object.entries(db.prayTimesAdjust).filter(([, v]) => String(v).trim().length > 0)
    ),
    prayTimesTune: Object.fromEntries(
      Object.entries(db.prayTimesTune).filter(([, v]) => Number(v) < 0 || Number(v) > 0)
    ),
    items: Object.keys(db.prayName),
    thead: ['Tgl', ...Object.values(db.prayName)]
  }
  return ok(data)
}

async function handleResetDevice(dt, env, origin, request) {
  if (dt !== 'KONFIRMASI') return fail('Not confirm...')
  await putDb(env, structuredClone(DEFAULT_DB))
  await notifyHub(env)
  await invalidateDisplayCache(origin)
  return json(
    { success: true, registered: false, data: null },
    { 'Set-Cookie': sessionClearCookie(request) }
  )
}

// Manual Kemenag official-schedule sync from the admin dashboard.
// Requires internet; failures are reported back to the admin as an error message.
async function handleSyncKemenag(env) {
  try {
    const result = await syncKemenag(env, { log: () => {} })
    if (result.skipped) return fail('Sinkron Kemenag belum aktif/lengkap: ' + result.reason)
    return ok({ last_sync: result.last_sync, synced: result.synced })
  } catch (err) {
    return fail('Gagal sinkron Kemenag: ' + err.message)
  }
}

// Kemenag province & regency lists (scraped from the real site, always accurate).
async function handleKemenagKabkota(dt) {
  if (!dt?.provid) return fail('provid wajib diisi')
  try {
    const cookie = await getSession()
    return ok(await getKabkota({ provid: dt.provid, cookie }))
  } catch (err) {
    return fail('Gagal mengambil daftar kabupaten/kota: ' + err.message)
  }
}

async function handleKemenagProvinsi() {
  try {
    const cookie = await getSession()
    return ok(await getProvinsi(cookie))
  } catch (err) {
    return fail('Gagal mengambil daftar provinsi: ' + err.message)
  }
}

// --- logo (kiri/kanan judul nama masjid) -------------------------------------

// Upload logo via multipart/form-data: fields `side` (left|right) + `file`.
// Validasi tipe & ukuran, simpan via logoStore (file lokal / KV Workers),
// lalu tulis URL baru (dengan ?v= epoch utk cache-busting) ke db.logo[side].
async function handleLogoUpload(request, env, origin) {
  try {
    const form = await request.formData()
    const side = String(form.get('side') || '')
    const file = form.get('file')
    if (!LOGO_SIDES.includes(side)) return fail('Sisi logo harus left atau right')
    if (!file || typeof file === 'string') return fail('File logo tidak ditemukan')

    const check = validateLogoFile({ contentType: file.type, size: file.size })
    if (check.error) return fail(check.error)

    const store = logoStoreFromEnv(env)
    if (!store) return fail('Penyimpanan logo tidak tersedia')

    const buffer = new Uint8Array(await file.arrayBuffer())
    await store.save(side, buffer, check.ext)
    const version = Date.now()
    const url = store.urlFor(side, check.ext, version)

    const db = await getDb(env)
    db.logo = { ...db.logo, [side]: url }
    await putDb(env, db)
    await notifyHub(env)
    await invalidateDisplayCache(origin)
    return ok({ side, url })
  } catch (err) {
    return fail('Gagal unggah logo: ' + err.message)
  }
}

// Hapus logo satu sisi: bersihkan file/KV dan kosongkan db.logo[side].
async function handleLogoRemove(dt, env, origin) {
  try {
    const side = String(dt?.side || '')
    if (!LOGO_SIDES.includes(side)) return fail('Sisi logo harus left atau right')
    const store = logoStoreFromEnv(env)
    if (store) await store.remove(side)
    const db = await getDb(env)
    db.logo = { ...db.logo, [side]: '' }
    await putDb(env, db)
    await notifyHub(env)
    await invalidateDisplayCache(origin)
    return ok({ side })
  } catch (err) {
    return fail('Gagal hapus logo: ' + err.message)
  }
}

// --- entrypoint -------------------------------------------------------------

const HANDLERS = {
  login: (body, env, _origin, request) => handleLogin(body, env, request),
  logout: (_body, _env, _origin, request) => handleLogout(request),
  changeDbCheck: (_body, env) => handleChangeDbCheck(env),
  readDatabase: (_body, env) => handleReadDatabase(env),
  formSave: (body, env, origin) => handleFormSave(body.dt || {}, env, origin),
  formDelete: (body, env, origin) => handleFormDelete(body.dt || {}, env, origin),
  getPraySetting: (_body, env) => handleGetPraySetting(env),
  syncKemenag: (_body, env) => handleSyncKemenag(env),
  kemenagKabkota: (body) => handleKemenagKabkota(body.dt || {}),
  kemenagProvinsi: () => handleKemenagProvinsi(),
  logoRemove: (body, env, origin) => handleLogoRemove(body.dt || {}, env, origin),
  resetDevice: (body, env, origin, request) => handleResetDevice(body.dt, env, origin, request)
}

const PUBLIC_HANDLERS = new Set(['login', 'logout', 'changeDbCheck'])

export async function handleProses(request, env) {
  const contentType = request.headers.get('Content-Type') || ''
  // multipart: id diambil dari field form ringan tanpa memparse file
  let body = {}
  if (contentType.includes('multipart/form-data')) {
    body = { id: null, __multipart: true }
  } else {
    body = await readBody(request).catch(() => ({}))
  }
  const id = body.id
  const token = getCookie(request, COOKIE_NAME)
  const user = await verifySessionToken(env.AUTH_SECRET, token)
  const origin = new URL(request.url).origin

  // Check order mirrors verification() in session.php:
  // not logged in → registered:false; logged in but unknown id → error.
  // multipart: id harus 'logoUpload' satu-satunya operasi multipart yang sah
  if (body.__multipart) {
    if (!user) return unregistered()
    return handleLogoUpload(request, env, origin)
  }
  if (!id || !HANDLERS[id]) {
    return user
      ? json({ success: false, registered: true, data: 'Request tidak ditemukan...' })
      : unregistered()
  }
  if (!PUBLIC_HANDLERS.has(id) && !user) {
    return unregistered()
  }
  return HANDLERS[id](body, env, origin, request)
}

export { COOKIE_NAME }
