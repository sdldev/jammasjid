// Cloudflare Quick Tunnel (mode lokal saja): mengekspos display ke URL publik
// sementara https://*.trycloudflare.com tanpa akun/domain Cloudflare.
//
// Sifat Quick Tunnel: EPHEMERAL — URL berubah setiap start dan proses ikut
// mati saat server restart. Cocok untuk akses publik sesekali (mis. kontrol
// waktu dari luar), bukan URL permanen. Untuk permanen pakai Named Tunnel.
//
// Dipanggil dari proses.js — impor DINAMIS agar bundle Workers tidak menarik
// node:child_process.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

// State proses in-memory: hilang saat server restart = tunnel otomatis mati.
let current = null   // { proc, url|null, startedAt, log[], err|null }

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const MAX_LOG = 40

function cariBin() {
  // Lokasi umum: PATH, /usr/local/bin (dipasang install.sh)
  for (const p of ['/usr/local/bin/cloudflared', '/usr/bin/cloudflared']) {
    if (existsSync(p)) return p
  }
  return 'cloudflared'   // andalkan PATH
}

export function tunnelStatus() {
  if (!current) return { running: false, url: '', startedAt: null, log: '' }
  return {
    running: current.proc.exitCode === null,
    url: current.url || '',
    startedAt: current.startedAt,
    log: current.log.slice(-10).join('\n'),
    error: current.err
  }
}

export function startTunnel(port) {
  if (current && current.proc.exitCode === null) {
    return { ok: true, url: current.url || '', already: true }
  }
  const bin = cariBin()
  let proc
  try {
    proc = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    return { ok: false, message: `cloudflared tidak ditemukan: ${err.message}` }
  }

  current = { proc, url: null, startedAt: new Date().toISOString(), log: [], err: null }

  const onData = (chunk) => {
    const text = chunk.toString()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      current.log.push(line)
      if (current.log.length > MAX_LOG) current.log.shift()
      if (!current.url) {
        const m = line.match(URL_RE)
        if (m) current.url = m[0]
      }
    }
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)   // cloudflared menulis URL ke stderr
  proc.on('error', (err) => { current.err = err.message })
  proc.on('close', () => { /* status dibaca lewat exitCode */ })

  return { ok: true, url: null }
}

export function stopTunnel() {
  if (!current || current.proc.exitCode !== null) {
    current = null
    return { ok: true, stopped: false }
  }
  current.proc.kill('SIGTERM')
  current = null
  return { ok: true, stopped: true }
}
