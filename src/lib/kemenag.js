// Fetch official prayer times from bimasislam.kemenag.go.id.
// Mechanism follows https://github.com/saktimw/api-jadwal-shalat:
//   1. HEAD /jadwalshalat            → grab session cookie (PHPSESSID)
//   2. POST /ajax/getShalatbln       → one month of schedule as JSON
//      form-encoded body: x=provid, y=kabkotid, bln=month, thn=year
// Network failures simply throw; the caller (scheduler) stays quiet while
// the device has no internet connection.

const BASE_URL = 'https://bimasislam.kemenag.go.id'
const FETCH_TIMEOUT_MS = 15_000

// Required header: the Kemenag site ignores requests without X-Requested-With
function ajaxHeaders(cookie) {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': cookie,
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${BASE_URL}/jadwalshalat`,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) DisplayMasjid/1.0'
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

// HEAD the jadwalshalat page → first session cookie (e.g. "PHPSESSID=abc123")
export async function getSession() {
  const res = await fetchWithTimeout(`${BASE_URL}/jadwalshalat`, {
    method: 'HEAD',
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) DisplayMasjid/1.0' }
  })
  if (res.status !== 200) throw new Error(`Kemenag session: HTTP ${res.status}`)
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  if (!setCookies.length) throw new Error('Kemenag session: tidak ada Set-Cookie')
  return setCookies[0].split(';')[0].trim()
}

// Province list (scraped from <select id="search_prov"> on the jadwalshalat page)
// → [{value, label}]. Single source of truth for region IDs — never hardcode.
export async function getProvinsi(cookie) {
  const res = await fetchWithTimeout(`${BASE_URL}/jadwalshalat`, {
    headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) DisplayMasjid/1.0' }
  })
  const html = await res.text()
  const i = html.indexOf('search_prov')
  if (i < 0) throw new Error('Kemenag: elemen search_prov tidak ditemukan')
  const snippet = html.slice(i, i + 12000)
  const out = []
  for (const m of snippet.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)) {
    if (m[1] === '') continue
    out.push({ value: m[1], label: m[2] })
  }
  if (!out.length) throw new Error('Kemenag: daftar provinsi kosong')
  return out
}

// Regency/city list for one province → [{value, label}].
// Lets the admin find region IDs without guessing.
export async function getKabkota({ provid, cookie }) {
  const res = await fetchWithTimeout(`${BASE_URL}/ajax/getKabkoshalat`, {
    method: 'POST',
    headers: ajaxHeaders(cookie),
    body: new URLSearchParams({ x: String(provid) })
  })
  const text = await res.text()
  if (text.includes('Illegal Key')) {
    const err = new Error('Kemenag session kedaluwarsa')
    err.code = 'ILLEGAL_KEY'
    throw err
  }
  const out = []
  for (const m of text.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)) {
    out.push({ value: m[1], label: m[2] })
  }
  return out
}

// Fetch one month of schedule. Returns the raw object from the Kemenag API.
export async function getJadwalBulan({ provid, kabkotid, bulan, tahun, cookie }) {
  const body = new URLSearchParams({
    x: String(provid),
    y: String(kabkotid),
    bln: String(bulan),
    thn: String(tahun)
  })
  const res = await fetchWithTimeout(`${BASE_URL}/ajax/getShalatbln`, {
    method: 'POST',
    headers: ajaxHeaders(cookie),
    body
  })
  const text = await res.text()
  // Expired session → the site answers "Illegal Key"
  if (text.includes('Illegal Key')) {
    const err = new Error('Kemenag session kedaluwarsa')
    err.code = 'ILLEGAL_KEY'
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Kemenag: respons bukan JSON (HTTP ${res.status})`)
  }
}

// Read the Date header from a response → difference (Kemenag server time −
// local clock) in ms. Used to correct RTC-less STB clocks that drift on power
// loss. Positive means the local clock is behind.
export function offsetDariHeaders(headers) {
  const dateHeader = headers.get('Date')
  if (!dateHeader) return null
  const waktuServer = new Date(dateHeader).getTime()
  if (isNaN(waktuServer)) return null
  return waktuServer - Date.now()
}

// Fetch a month with a single auto-retry on expired session.
// Also measures the clock offset (offsetMs) from the Date header.
export async function getJadwalBulanRetry(params) {
  let cookie = await getSession()
  let offsetMs = null
  try {
    const { data, response } = await getJadwalBulanDenganRespons({ ...params, cookie })
    offsetMs = offsetDariHeaders(response.headers)
    return { data, offsetMs }
  } catch (err) {
    if (err.code !== 'ILLEGAL_KEY') throw err
    cookie = await getSession() // refresh session and retry once
    const { data, response } = await getJadwalBulanDenganRespons({ ...params, cookie })
    offsetMs = offsetDariHeaders(response.headers)
    return { data, offsetMs }
  }
}

// Internal variant: return data plus the raw Response object (for headers).
async function getJadwalBulanDenganRespons({ provid, kabkotid, bulan, tahun, cookie }) {
  const body = new URLSearchParams({
    x: String(provid),
    y: String(kabkotid),
    bln: String(bulan),
    thn: String(tahun)
  })
  const response = await fetchWithTimeout(`${BASE_URL}/ajax/getShalatbln`, {
    method: 'POST',
    headers: ajaxHeaders(cookie),
    body
  })
  const text = await response.text()
  if (text.includes('Illegal Key')) {
    const err = new Error('Kemenag session kedaluwarsa')
    err.code = 'ILLEGAL_KEY'
    throw err
  }
  try {
    return { data: JSON.parse(text), response }
  } catch {
    throw new Error(`Kemenag: respons bukan JSON (HTTP ${response.status})`)
  }
}

// Normalize the Kemenag response → map 'YYYY-MM-DD' -> 24h times.
// Response field names (per the reference repo): tanggal, imsak, subuh, terbit,
// dhuha, dzuhur, ashar, maghrib, isya — the date may be "YYYY-MM-DD" or "DD-MM-YYYY".
export function normalizeJadwal(raw, bulan, tahun) {
  const out = {}
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw?.jadwal || raw?.data || raw || {}).map(([key, row]) => {
        // Date-keyed object ('2026-10-01' → {...}): use the key when the row
        // does not carry its own date field.
        if (row && typeof row === 'object' && !row.tanggal && !row.date) {
          return { ...row, tanggal: key }
        }
        return row
      })
  for (const row of list) {
    if (!row) continue
    const tgl = row.tanggal || row.date
    const iso = toIsoDate(tgl, bulan, tahun)
    if (!iso) continue
    out[iso] = {
      fajr: toHm(row.subuh),
      sunrise: toHm(row.terbit),
      dhuhr: toHm(row.dzuhur),
      asr: toHm(row.ashar),
      maghrib: toHm(row.maghrib),
      isha: toHm(row.isya)
    }
  }
  return out
}

function toIsoDate(value, bulan, tahun) {
  if (!value) return null
  const s = String(value).trim()
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/) // YYYY-MM-DD (map key or field)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/) // DD/MM/YYYY, e.g. "Kamis, 01/10/2026"
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  m = s.match(/^(\d{1,2})$/) // day number only
  if (m && bulan && tahun) return `${tahun}-${pad(bulan)}-${pad(m[1])}`
  return null
}

function toHm(value) {
  const m = String(value || '').match(/(\d{1,2})[:.](\d{2})/)
  return m ? `${pad(m[1])}:${m[2]}` : ''
}

function pad(n) {
  return String(n).padStart(2, '0')
}
