// Local updater: meluncurkan scripts/update.sh dari dalam server Bun.
// Hanya dipakai mode lokal (STB) — Workers tidak memiliki child_process.
//
// update.sh berjalan di subproses dengan stdout/stderr disalin ke file log
// agar admin bisa mem-poll progres via handler updateStatus. Restart service
// dijadwalkan oleh update.sh sendiri (--restart-delay, subshell detached)
// supaya respons HTTP 'started' sempat terkirim sebelum proses ini dimatikan.

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'update.sh')
// Log diletakkan di lokasi yang bisa ditulis user proses (non-root).
const LOG_DIR = join(ROOT, 'db', 'update-logs')
const KEEP_LOGS = 5

// Hanya satu update yang berjalan pada satu waktu (per proses).
let current = null   // { startedAt, logFile, exitCode|null }

// Status "running" ditentukan oleh UMUR log, bukan keadaan proses anak:
// server di-restart update.sh (restart-delay) mematikan proses ini sebelum
// child.on('close') terekam — tanpa guard, update berikutnya ditolak
// 'sedang berjalan' selamanya. Ambang: log tak berubah > 30 detik = selesai.
const STALE_MS = 30_000

function pruneLogs() {
  try {
    const files = readdirSync(LOG_DIR)
      .map((f) => join(LOG_DIR, f))
      .filter((p) => { try { return statSync(p).isFile() } catch { return false } })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const p of files.slice(KEEP_LOGS)) rmSync(p, { force: true })
  } catch { /* abaikan */ }
}

export function updateRunning() {
  if (!current || current.exitCode !== null) return null
  try {
    const stale = Date.now() - statSync(current.logFile).mtimeMs > STALE_MS
    if (stale) current.exitCode = -2   // -2 = log basi (server restart memutus proses)
  } catch { current.exitCode = -2 }
  return current.exitCode === null ? current : null
}

// Luncurkan update.sh. Mengembalikan { started, logFile } atau
// melempar Error bila sedang ada update berjalan.
export function runUpdate() {
  if (updateRunning()) throw new Error('Update sedang berjalan — tunggu sampai selesai.')
  if (!existsSync(SCRIPT)) throw new Error('scripts/update.sh tidak ditemukan')

  mkdirSync(LOG_DIR, { recursive: true })
  pruneLogs()
  const logFile = join(LOG_DIR, `update-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  const out = createWriteStream(logFile)

  // --restart-delay 10: subshell update.sh menunggu 10 detik sebelum
  // systemctl restart — cukup bagi admin untuk menerima respons 'started'
  // dan mulai mem-poll; ketika server mati, polling gagal → admin memuat ulang.
  const child = spawn('bash', [SCRIPT, '--restart-delay', '10'], {
    cwd: ROOT,
    env: process.env
  })
  current = { startedAt: Date.now(), logFile, exitCode: null }
  child.stdout.pipe(out)
  child.stderr.pipe(out)
  child.on('close', (code) => {
    current.exitCode = code
    out.end()
  })
  child.on('error', () => {
    current.exitCode = -1
    out.end()
  })
  return { started: true, logFile }
}

// Baca status + ekor log untuk UI admin.
export function readUpdateStatus() {
  if (!existsSync(LOG_DIR)) return { running: false, log: '', exitCode: null, logFile: null }
  const files = readdirSync(LOG_DIR)
    .map((f) => join(LOG_DIR, f))
    .filter((p) => { try { return statSync(p).isFile() } catch { return false } })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!files.length) return { running: false, log: '', exitCode: null, logFile: null }
  const latest = files[0]
  const isCurrent = current && current.logFile === latest
  const text = readFileSync(latest, 'utf8')
  const lines = text.trimEnd().split('\n')
  // -2 = log basi: server ter-restart sebelum exit tercatat — anggap selesai.
  const effectiveExit = isCurrent && current.exitCode === null &&
    Date.now() - statSync(latest).mtimeMs > STALE_MS ? -2 : (isCurrent ? current.exitCode : null)
  return {
    running: effectiveExit === null && isCurrent,
    log: lines.slice(-60).join('\n'),
    exitCode: effectiveExit,
    logFile: latest
  }
}
