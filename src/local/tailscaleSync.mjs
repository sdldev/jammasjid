// Sinkronisasi ACL Tailscale dari panel admin (mode lokal saja).
// Membangun db/tailscale-acl.json dari daftar email pengurus lalu menjalankan
// scripts/tailscale-acl.sh untuk menerapkannya ke tailnet.
//
// Dipanggil dari proses.js (handleTailscaleSetup) — impor DINAMIS agar bundle
// Workers tidak menarik node:child_process.

import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'tailscale-acl.sh')
const ACL_FILE = join(ROOT, 'db', 'tailscale-acl.json')
// Port default install.sh; bisa di-override lewat env PORT (diambil dari .env
// oleh proses pemanggil, tapi script bash sudah membaca ACL-nya sendiri).
const ADMIN_PORT = process.env.PORT || '11111'

// Pemilik tailnet = email developer (pemilik akun yang login saat tailscale up).
// Diset installer (TAILSCALE_OWNER di .env); fallback aman ke nilai repo.
const OWNER = process.env.TAILSCALE_OWNER || 'satrimuhub@gmail.com'

function buildAcl(emails) {
  return {
    tagOwners: {
      'tag:server': [OWNER],
      'tag:dev': [OWNER],
      // Pengurus boleh lebih dari satu; daftar datang dari panel admin.
      'tag:pengurus': [OWNER, ...emails]
    },
    acls: [
      // Developer: SSH + admin web.
      { action: 'accept', src: ['tag:dev'], dst: [`tag:server:22,${ADMIN_PORT}`] },
      // Pengurus: hanya admin web — SSH tetap tertutup.
      { action: 'accept', src: ['tag:pengurus'], dst: [`tag:server:${ADMIN_PORT}`] }
    ]
  }
}

// Tulis ACL secara atomik (pola sama dengan adapter db/jadwalStore).
export function tulisAclFile(emails) {
  mkdirSync(dirname(ACL_FILE), { recursive: true })
  const tmp = ACL_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(buildAcl(emails), null, 2) + '\n')
  renameSync(tmp, ACL_FILE)
  return ACL_FILE
}

function jalankanSkrip() {
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT, ACL_FILE], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, message: `gagal menjalankan tailscale-acl.sh: ${stderr || err.message}` })
        return
      }
      let parsed = null
      try { parsed = JSON.parse(String(stdout).trim().split('\n').pop()) } catch { /* abaikan */ }
      if (!parsed) {
        resolve({ ok: false, message: 'output tailscale-acl.sh tidak terbaca' })
        return
      }
      resolve(parsed)
    })
  })
}

// Titik masuk utama: tulis file ACL lalu terapkan.
export async function sinkronTailscaleAcl(emails) {
  if (!existsSync(SCRIPT)) return { ok: false, message: 'scripts/tailscale-acl.sh tidak ditemukan' }
  tulisAclFile(emails)
  const hasil = await jalankanSkrip()
  return hasil
}

// Dipakai handler/UI: status singkat tailscale di mesin ini.
export function statusTailscale() {
  try {
    return JSON.parse(readFileSync(ACL_FILE, 'utf8'))
  } catch {
    return null
  }
}
