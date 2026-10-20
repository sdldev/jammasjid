// Stateless session: HMAC-signed cookie replacing PHP $_SESSION.
// Token format: base64url(expiry.user) . "." . base64url(hmacSha256(secret, payload))

const COOKIE_NAME = 'dm_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function toBase64Url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export async function createSessionToken(secret, user) {
  const expiry = Date.now() + SESSION_TTL_MS
  const payload = `${expiry}.${user}`
  const key = await importKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  return `${toBase64Url(new TextEncoder().encode(payload))}.${toBase64Url(sig)}`
}

export async function verifySessionToken(secret, token) {
  if (!token) return null
  const [encodedPayload, encodedSig] = token.split('.')
  if (!encodedPayload || !encodedSig) return null
  try {
    const payloadBytes = fromBase64Url(encodedPayload)
    const payload = new TextDecoder().decode(payloadBytes)
    const [expiryRaw, user] = payload.split('.')
    if (!expiryRaw || !user) return null
    if (Number(expiryRaw) < Date.now()) return null
    const key = await importKey(secret)
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(encodedSig), payloadBytes)
    return valid ? user : null
  } catch {
    return null
  }
}

// Flag `Secure` hanya dipasang pada origin HTTPS. Admin sering diakses lewat
// http://<ip-stb> di LAN; browser membuang cookie Secure pada HTTP sehingga
// login "berhasil" tapi sesi hilang (dashboard tidak pernah muncul).
function isSecureOrigin(request) {
  // Default aman: tanpa request dianggap HTTPS.
  if (!request) return true
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return true
  }
}

export function sessionSetCookie(token, request) {
  const secure = isSecureOrigin(request) ? '; Secure' : ''
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
}

export function sessionClearCookie(request) {
  const secure = isSecureOrigin(request) ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export { COOKIE_NAME }
