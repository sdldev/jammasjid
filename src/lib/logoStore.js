// Logo storage (kiri/kanan judul nama masjid), separate from database.json.
// Dua backend, pola sama seperti jadwalStore.js:
//   - Lokal  : file fisik public/img/logo-{side}.{ext} (tulis atomik tmp+rename),
//              disajikan oleh serveStatic yang sudah ada.
//   - Workers: ASSETS read-only → simpan base64 di KV (key 'logo-{side}'),
//              disajikan oleh route GET /logo/{side}.
// db.logo[side] menyimpan URL final (dibuat handler upload sesuai runtime aktif)
// dengan query ?v={epoch} untuk cache-busting (cache media 30 hari).

import { writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Ekstensi yang diizinkan (disamakan dengan whitelist tipe upload)
const ALLOWED_EXT = ['png', 'jpg', 'jpeg']
const MAX_BYTES = 4 * 1024 * 1024 // 4 MB

export const LOGO_SIDES = ['left', 'right']

export function validateLogoFile({ contentType, size }) {
  const ct = String(contentType || '').toLowerCase()
  if (!['image/png', 'image/jpeg'].includes(ct)) {
    return { error: 'Tipe file harus PNG atau JPG' }
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return { error: 'Ukuran file maksimal 4 MB' }
  }
  return { ext: ct === 'image/png' ? 'png' : 'jpg' }
}

// --- file backend (mode lokal) ----------------------------------------------

export function createFileLogoStore(imgDir) {
  // Hapus file logo sisi ini dengan ekstensi lain agar tidak menumpuk sisa
  function bersihkanSisi(side, keepExt) {
    for (const ext of ALLOWED_EXT) {
      if (ext === keepExt) continue
      const f = join(imgDir, `logo-${side}.${ext}`)
      if (existsSync(f)) { try { unlinkSync(f) } catch { /* best-effort */ } }
    }
  }
  return {
    backend: 'file',
    async save(side, buffer, ext) {
      const file = join(imgDir, `logo-${side}.${ext}`)
      // Tulis atomik: tmp lalu rename (pola jadwalStore) agar file tidak
      // setengah-jadi saat dibaca serveStatic.
      const tmp = `${file}.tmp`
      writeFileSync(tmp, buffer)
      renameSync(tmp, file)
      bersihkanSisi(side, ext)
      return { file: `logo-${side}.${ext}` }
    },
    async remove(side) {
      for (const ext of ALLOWED_EXT) {
        const f = join(imgDir, `logo-${side}.${ext}`)
        if (existsSync(f)) { try { unlinkSync(f) } catch { /* best-effort */ } }
      }
    },
    // URL yang disimpan ke db (serveStatic sudah memberi cache 30 hari)
    urlFor(side, ext, version) {
      return `/img/logo-${side}.${ext}?v=${version}`
    }
  }
}

// --- KV backend (mode Workers) ----------------------------------------------

export function createKvLogoStore(kv) {
  return {
    backend: 'kv',
    async save(side, buffer, ext) {
      // base64 agar bisa disimpan sebagai teks KV; contentType ikut disimpan
      const data = Buffer.from(buffer).toString('base64')
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
      await kv.put(`logo-${side}`, JSON.stringify({ data, contentType }))
      return {}
    },
    async remove(side) {
      await kv.delete(`logo-${side}`)
    },
    // URL yang disimpan ke db (route GET /logo/{side} memberi cache 30 hari)
    urlFor(side, _ext, version) {
      return `/logo/${side}?v=${version}`
    },
    async load(side) {
      const raw = await kv.get(`logo-${side}`, 'json')
      if (!raw || !raw.data) return null
      return { buffer: Uint8Array.from(atob(raw.data), (c) => c.charCodeAt(0)), contentType: raw.contentType }
    }
  }
}

// Pilih store dari env: adapter lokal menyediakan env.LOGO_STORE,
// Workers jatuh ke KV (env.DATABASE). Tidak ada → fitur logo nonaktif.
export function storeFromEnv(env) {
  if (env.LOGO_STORE) return env.LOGO_STORE
  if (env.DATABASE) return createKvLogoStore(env.DATABASE)
  return null
}
