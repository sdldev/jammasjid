// Manajemen WiFi (mode lokal saja) — memakai NetworkManager lewat nmcli.
//
// Dipanggil dari proses.js dengan import DINAMIS agar bundle Workers tidak
// menarik node:child_process. Semua fungsi mengembalikan { ok, ... } dan tidak
// pernah melempar error untuk kegagalan yang wajar (pola sama dengan
// tailscaleSync.mjs / quickTunnel.mjs).
//
// Keamanan:
//   - Password WiFi TIDAK pernah dikirim lewat argv (terlihat di `ps`).
//     Profil ditulis sebagai keyfile sementara 0600 lalu `nmcli connection load`.
//   - Hanya menyentuh wlan0; eth0 dan Tailscale tidak pernah diubah.
//   - Profil baru dibuat dengan autoconnect=no selama masa uji, lalu
//     diaktifkan permanen setelah dikonfirmasi (atau koneksi terbukti hidup).

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATE_FILE = join(ROOT, 'db', 'wifi-trial.json')
const IFACE = 'wlan0'

// Masa uji sebelum konfigurasi WiFi baru dianggap gagal dan dikembalikan.
export const TRIAL_MS = 120_000

// ---------------------------------------------------------------- validasi ---

export function validasiSsid(ssid) {
  const s = typeof ssid === 'string' ? ssid : ''
  if (!s.trim()) return { ok: false, message: 'SSID wajib diisi' }
  if (Buffer.byteLength(s, 'utf8') > 32) return { ok: false, message: 'SSID maksimal 32 byte' }
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, message: 'SSID mengandung karakter tidak valid' }
  if (s !== s.trim()) return { ok: false, message: 'SSID tidak boleh diawali atau diakhiri spasi' }
  return { ok: true, ssid: s }
}

// keamanan: true bila jaringan memakai WPA/WPA2/WPA3 (butuh password).
export function validasiPassword(password, butuhPassword) {
  const p = typeof password === 'string' ? password : ''
  if (!butuhPassword) {
    if (p) return { ok: false, message: 'Jaringan terbuka tidak memakai password' }
    return { ok: true, password: '' }
  }
  if (p.length === 64 && /^[0-9a-fA-F]+$/.test(p)) return { ok: true, password: p }
  if (p.length < 8 || p.length > 63) {
    return { ok: false, message: 'Password WiFi harus 8–63 karakter' }
  }
  if (/[\u0000-\u001f\u007f]/.test(p)) {
    return { ok: false, message: 'Password mengandung karakter tidak valid' }
  }
  return { ok: true, password: p }
}

// ---------------------------------------------------------------- parser ----

// Output `nmcli -t` meng-escape ':' dan '\' dengan backslash.
export function pecahTerse(line) {
  const out = []
  let cur = ''
  let esc = false
  for (const ch of String(line)) {
    if (esc) { cur += ch; esc = false }
    else if (ch === '\\') esc = true
    else if (ch === ':') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

// `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`
// Satu SSID bisa muncul beberapa kali (mesh/repeater) → ambil sinyal terkuat,
// prioritaskan yang sedang dipakai.
export function parseScan(stdout) {
  const map = new Map()
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue
    const f = pecahTerse(line)
    if (f.length < 4) continue
    const aktif = f[0].trim() === '*'
    const ssid = f[1]
    if (!ssid) continue // AP tersembunyi tidak punya SSID di hasil scan
    const sinyal = Number(f[2]) || 0
    const keamanan = f[3].trim()
    const lama = map.get(ssid)
    const lebihBaik = !lama ||
      (aktif && !lama.aktif) ||
      (aktif === lama.aktif && sinyal > lama.sinyal)
    if (lebihBaik) {
      map.set(ssid, { ssid, sinyal, keamanan, aktif, terbuka: !keamanan || keamanan === '--' })
    }
  }
  return [...map.values()].sort((a, b) => (Number(b.aktif) - Number(a.aktif)) || (b.sinyal - a.sinyal))
}

// `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status`
export function parseDevices(stdout) {
  const out = []
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue
    const f = pecahTerse(line)
    if (f.length < 4) continue
    out.push({ device: f[0], tipe: f[1], state: f[2], koneksi: f[3] })
  }
  return out
}

// `nmcli -t -f IP4.ADDRESS device show wlan0` → IP pertama tanpa prefix.
export function parseIp4(stdout) {
  for (const line of String(stdout).split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const v = line.slice(i + 1).trim()
    if (v && /^\d+\.\d+\.\d+\.\d+/.test(v)) return v.split('/')[0]
  }
  return ''
}

// -------------------------------------------------------------- keyfile -----

export function bangunKeyfile({ uuid, ssid, password, hidden, autoconnect = false, priority = 0, nama }) {
  const lines = [
    '[connection]',
    'id=' + (nama || ssid),
    'uuid=' + uuid,
    'type=wifi',
    'autoconnect=' + (autoconnect ? 'yes' : 'no'),
    'autoconnect-priority=' + Number(priority || 0),
    '',
    '[wifi]',
    'mode=infrastructure',
    'ssid=' + ssid,
    'hidden=' + (hidden ? 'yes' : 'no'),
    ''
  ]
  if (password) {
    lines.push('[wifi-security]', 'key-mgmt=wpa-psk', 'psk=' + password, '')
  }
  lines.push('[ipv4]', 'method=auto', '', '[ipv6]', 'method=auto', '')
  return lines.join('\n')
}

// ---------------------------------------------------------------- service ---

function jalankan(execFileFn, cmd, args, timeout = 15_000) {
  return new Promise((resolve) => {
    try {
      execFileFn(cmd, args, { timeout }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (err.code ?? 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || (err && err.message) || '')
        })
      })
    } catch (err) {
      resolve({ ok: false, code: 1, stdout: '', stderr: err.message })
    }
  })
}

function pesanError(r) {
  const s = String(r.stderr || '').trim()
  if (/not authorized|not permitted|access denied|insufficient privileges|NotAuthorized/i.test(s)) {
    return 'Akses NetworkManager ditolak. Jalankan ulang install.sh agar aturan polkit WiFi terpasang.'
  }
  return s.split('\n').filter(Boolean)[0] || 'Perintah nmcli gagal'
}

export function buatService(opts = {}) {
  const execFileFn = opts.execFileFn || execFile
  const stateFile = opts.stateFile || STATE_FILE
  const now = opts.now || (() => Date.now())
  const pasangTimer = opts.setTimer || ((fn, ms) => {
    const t = setTimeout(fn, ms)
    if (t && typeof t.unref === 'function') t.unref()
    return t
  })
  const hapusTimer = opts.clearTimer || clearTimeout

  let timer = null

  const nmcli = (args, timeout) => jalankan(execFileFn, 'nmcli', args, timeout)

  // --- state trial (disimpan agar tetap berlaku walau server restart) -------
  function bacaState() {
    try {
      if (!existsSync(stateFile)) return null
      const s = JSON.parse(readFileSync(stateFile, 'utf8'))
      if (!s || !s.token) return null
      return s
    } catch { return null }
  }

  function tulisState(state) {
    mkdirSync(dirname(stateFile), { recursive: true })
    const tmp = stateFile + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, stateFile)
  }

  function hapusState() {
    try { rmSync(stateFile, { force: true }) } catch { /* abaikan */ }
  }

  function hentikanTimer() {
    if (timer) { hapusTimer(timer); timer = null }
  }

  // --- query ---------------------------------------------------------------
  async function profilSemua() {
    const r = await nmcli(['-t', '-f', 'NAME,UUID,TYPE,AUTOCONNECT', 'connection', 'show'], 15_000)
    if (!r.ok) return { ok: false, message: pesanError(r) }
    const aktif = await nmcli(['-t', '-f', 'UUID,DEVICE', 'connection', 'show', '--active'], 15_000)
    const aktifSet = new Set()
    if (aktif.ok) {
      for (const line of aktif.stdout.split('\n')) {
        const f = pecahTerse(line)
        if (f.length >= 2 && f[1] === IFACE) aktifSet.add(f[0])
      }
    }
    const wifi = []
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue
      const f = pecahTerse(line)
      if (f.length < 4) continue
      if (f[2] !== '802-11-wireless') continue
      const detail = await nmcli([
        '-t', '-f', '802-11-wireless.ssid,connection.autoconnect-priority',
        'connection', 'show', 'uuid', f[1]
      ], 10_000)
      let ssid = ''
      let prioritas = 0
      if (detail.ok) {
        for (const d of detail.stdout.split('\n')) {
          const i = d.indexOf(':')
          if (i < 0) continue
          const k = d.slice(0, i)
          const v = d.slice(i + 1).trim()
          if (/^802-11-wireless\.ssid/.test(k)) ssid = v
          else if (/^connection\.autoconnect-priority/.test(k)) prioritas = Number(v) || 0
        }
      }
      wifi.push({
        uuid: f[1],
        nama: f[0],
        ssid,
        autoconnect: f[3] === 'yes',
        prioritas,
        aktif: aktifSet.has(f[1])
      })
    }
    return { ok: true, profil: wifi }
  }

  async function profilAktifWifi() {
    const r = await profilSemua()
    if (!r.ok) return null
    return r.profil.find((p) => p.aktif) || null
  }

  async function ipDevice(dev) {
    const r = await nmcli(['-t', '-f', 'IP4.ADDRESS', 'device', 'show', dev], 10_000)
    return r.ok ? parseIp4(r.stdout) : ''
  }

  async function ujiWifiHidup() {
    const d = await nmcli(['-t', '-f', 'DEVICE,STATE', 'device', 'status'], 10_000)
    if (!d.ok) return false
    let terhubung = false
    for (const line of d.stdout.split('\n')) {
      const f = pecahTerse(line)
      if (f.length >= 2 && f[0] === IFACE) terhubung = f[1] === 'connected'
    }
    if (!terhubung) return false
    return Boolean(await ipDevice(IFACE))
  }

  async function tailscaleIp() {
    const r = await jalankan(execFileFn, 'tailscale', ['ip', '-4'], 8_000)
    return r.ok ? r.stdout.trim().split('\n')[0] || '' : ''
  }

  async function tesInternet() {
    const r = await jalankan(execFileFn, 'ping', ['-c', '1', '-W', '2', '1.1.1.1'], 6_000)
    return r.ok
  }

  async function statusJaringan() {
    const dev = await nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status'], 10_000)
    const daftar = dev.ok ? parseDevices(dev.stdout) : []
    const wlan = daftar.find((d) => d.device === IFACE) || { state: 'unknown', koneksi: '' }
    const eth = daftar.find((d) => d.device === 'eth0') || { state: 'unknown', koneksi: '' }

    let ssid = ''
    let sinyal = 0
    if (wlan.state === 'connected') {
      const wifiList = await nmcli(['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list'], 15_000)
      if (wifiList.ok) {
        const aktif = parseScan(wifiList.stdout).find((j) => j.aktif)
        if (aktif) { ssid = aktif.ssid; sinyal = aktif.sinyal }
      }
    }

    const [ipWlan, ipEth, tsIp, internet] = await Promise.all([
      ipDevice(IFACE),
      ipDevice('eth0'),
      tailscaleIp(),
      tesInternet()
    ])
    const profilAktif = await profilAktifWifi()
    const trial = bacaState()

    return {
      ok: true,
      waktu: new Date(now()).toISOString(),
      wlan: {
        terhubung: wlan.state === 'connected',
        state: wlan.state,
        ssid,
        sinyal,
        ip: ipWlan,
        profil: profilAktif ? { uuid: profilAktif.uuid, nama: profilAktif.nama } : null
      },
      ethernet: { terhubung: eth.state === 'connected', state: eth.state, ip: ipEth },
      tailscale: { ip: tsIp, aktif: Boolean(tsIp) },
      internet,
      trial: trial
        ? {
            aktif: true,
            token: trial.token,
            ssidBaru: trial.ssidBaru,
            ssidLama: trial.ssidLama,
            sisaDetik: Math.max(0, Math.round((trial.deadline - now()) / 1000))
          }
        : null
    }
  }

  async function pindaiWifi() {
    const r = await nmcli([
      '-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'
    ], 35_000)
    if (!r.ok) return { ok: false, message: pesanError(r) }
    return { ok: true, jaringan: parseScan(r.stdout) }
  }

  // --- trial ---------------------------------------------------------------
  async function revertTrial(tokenHarap) {
    const state = bacaState()
    if (!state) return { ok: true, reverted: false }
    if (tokenHarap && state.token !== tokenHarap) return { ok: true, reverted: false }

    hentikanTimer()
    // Jangan tinggalkan profil baru menyala dengan autoconnect aktif.
    if (state.uuidBaru) {
      await nmcli(['connection', 'modify', 'uuid', state.uuidBaru, 'connection.autoconnect', 'no'], 15_000)
      await nmcli(['connection', 'down', 'uuid', state.uuidBaru], 25_000)
    }
    if (state.uuidLama) {
      await nmcli(['connection', 'up', 'uuid', state.uuidLama], 45_000)
    }
    // Profil baru yang belum terkonfirmasi dihapus agar daftar tidak menumpuk.
    if (state.uuidBaru) {
      await nmcli(['connection', 'delete', 'uuid', state.uuidBaru], 20_000)
    }
    hapusState()
    return { ok: true, reverted: true, ssidLama: state.ssidLama || '' }
  }

  function jadwalkanTrial(state) {
    hentikanTimer()
    const sisa = Math.max(0, state.deadline - now())
    timer = pasangTimer(async () => {
      timer = null
      // Bila WiFi baru ternyata hidup (punya IP), anggap sukses meski admin
      // tidak sempat menekan Konfirmasi — jangan batalkan perubahan yang baik.
      const hidup = await ujiWifiHidup()
      if (hidup) {
        await nmcli(['connection', 'modify', 'uuid', state.uuidBaru, 'connection.autoconnect', 'yes'], 15_000)
        hapusState()
        return
      }
      await revertTrial(state.token)
    }, sisa + 50)
  }

  function mulaiTrial({ uuidBaru, ssidBaru, uuidLama, ssidLama }) {
    const state = {
      token: randomUUID(),
      uuidBaru,
      ssidBaru,
      uuidLama: uuidLama || '',
      ssidLama: ssidLama || '',
      deadline: now() + TRIAL_MS
    }
    tulisState(state)
    jadwalkanTrial(state)
    return { token: state.token, sisaDetik: Math.round(TRIAL_MS / 1000) }
  }

  async function konfirmasiTrial(token) {
    const state = bacaState()
    if (!state || state.token !== token) {
      return { ok: false, message: 'Sesi uji tidak ditemukan atau sudah berakhir' }
    }
    if (now() > state.deadline) {
      return { ok: false, message: 'Waktu konfirmasi sudah habis — perubahan dikembalikan' }
    }
    hentikanTimer()
    await nmcli(['connection', 'modify', 'uuid', state.uuidBaru, 'connection.autoconnect', 'yes'], 15_000)

    // Hapus profil lain dengan SSID sama agar tidak ada dua profil bersaing.
    const semua = await profilSemua()
    if (semua.ok) {
      for (const p of semua.profil) {
        if (p.ssid === state.ssidBaru && p.uuid !== state.uuidBaru) {
          await nmcli(['connection', 'delete', 'uuid', p.uuid], 20_000)
        }
      }
    }
    hapusState()
    return { ok: true, ssid: state.ssidBaru }
  }

  async function batalkanTrial(token) {
    const state = bacaState()
    if (!state) return { ok: false, message: 'Tidak ada sesi uji yang berjalan' }
    if (token && state.token !== token) return { ok: false, message: 'Token sesi uji tidak cocok' }
    const hasil = await revertTrial(state.token)
    return { ok: true, reverted: hasil.reverted, ssidLama: hasil.ssidLama || '' }
  }

  // Dipanggil saat server start: lanjutkan/menuntaskan trial yang tertinggal.
  async function pulihkanTrial() {
    const state = bacaState()
    if (!state) return { ok: true, ada: false }
    if (now() >= state.deadline) {
      const hidup = await ujiWifiHidup()
      if (hidup) {
        await nmcli(['connection', 'modify', 'uuid', state.uuidBaru, 'connection.autoconnect', 'yes'], 15_000)
        hapusState()
        return { ok: true, ada: true, hasil: 'dikonfirmasi-otomatis' }
      }
      const r = await revertTrial(state.token)
      return { ok: true, ada: true, hasil: r.reverted ? 'dikembalikan' : 'tidak-ada' }
    }
    jadwalkanTrial(state)
    return { ok: true, ada: true, hasil: 'dijadwalkan' }
  }

  // --- aksi ----------------------------------------------------------------
  function namaProfilUnik(ssid, semua) {
    const dipakai = new Set(semua.map((p) => p.nama))
    if (!dipakai.has(ssid)) return ssid
    let n = 2
    while (dipakai.has(ssid + ' (' + n + ')')) n++
    return ssid + ' (' + n + ')'
  }

  async function tulisDanMuatKeyfile({ uuid, ssid, password, hidden, autoconnect, nama }) {
    let dir = ''
    try {
      dir = mkdtempSync(join(tmpdir(), 'jam-masjid-wifi-'))
      const file = join(dir, 'profil.nmconnection')
      const isi = bangunKeyfile({ uuid, ssid, password, hidden, autoconnect, nama })
      writeFileSync(file, isi, { mode: 0o600 })
      const r = await nmcli(['connection', 'load', file], 25_000)
      if (r.ok) return r
      // NetworkManager lama (1.10/Armbian) memblokir `connection load` lewat
      // polkit. Jalan sempit: helper root yang hanya menerima keyfile wifi.
      // WAJIB await: finally menghapus folder temp, jadi tanpa await file
      // sudah hilang sebelum sudo sempat membacanya.
      if (/access denied|not authorized|insufficient/i.test(r.stderr)) {
        return await jalankan(execFileFn, 'sudo', ['-n', '/usr/local/bin/jam-masjid-wifi-load', file], 25_000)
      }
      return r
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* abaikan */ } }
    }
  }

  async function sambungWifi({ ssid, password, hidden, terbuka, sambung = true, autoconnect = true }) {
    const vSsid = validasiSsid(ssid)
    if (!vSsid.ok) return vSsid
    const vPass = validasiPassword(password, !terbuka)
    if (!vPass.ok) return vPass

    const semua = await profilSemua()
    if (!semua.ok) return semua

    const lama = semua.profil.find((p) => p.aktif) || null
    const uuid = randomUUID()
    const nama = namaProfilUnik(vSsid.ssid, semua.profil)

    const muat = await tulisDanMuatKeyfile({
      uuid,
      ssid: vSsid.ssid,
      password: vPass.password,
      hidden: Boolean(hidden),
      // Selama belum dikonfirmasi, jangan biarkan STB boot ke profil baru.
      autoconnect: sambung ? false : Boolean(autoconnect),
      nama
    })
    if (!muat.ok) return { ok: false, message: pesanError(muat) }

    if (!sambung) {
      return { ok: true, disimpan: true, uuid, ssid: vSsid.ssid, nama }
    }

    const naik = await nmcli(['connection', 'up', 'uuid', uuid], 60_000)
    if (!naik.ok) {
      // Bersihkan profil yang gagal, lalu hidupkan kembali profil lama.
      await nmcli(['connection', 'delete', 'uuid', uuid], 20_000)
      if (lama) await nmcli(['connection', 'up', 'uuid', lama.uuid], 45_000)
      return { ok: false, message: 'Gagal menyambung: ' + pesanError(naik) }
    }

    // Profil lama dengan SSID sama tidak dihapus dulu — baru dihapus setelah
    // konfirmasi, sehingga trial bisa kembali ke keadaan semula.
    let trial = null
    if (!lama || lama.uuid !== uuid) {
      trial = mulaiTrial({
        uuidBaru: uuid,
        ssidBaru: vSsid.ssid,
        uuidLama: lama ? lama.uuid : '',
        ssidLama: lama ? lama.ssid : ''
      })
    } else {
      await nmcli(['connection', 'modify', 'uuid', uuid, 'connection.autoconnect', 'yes'], 15_000)
    }
    return { ok: true, uuid, ssid: vSsid.ssid, nama, trial }
  }

  async function aksiProfil({ uuid, action, nilai }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(uuid || ''))) {
      return { ok: false, message: 'UUID profil tidak valid' }
    }
    const semua = await profilSemua()
    if (!semua.ok) return semua
    const profil = semua.profil.find((p) => p.uuid === uuid)
    if (!profil) return { ok: false, message: 'Profil WiFi tidak ditemukan' }

    if (action === 'activate') {
      const lama = semua.profil.find((p) => p.aktif && p.uuid !== uuid) || null
      const naik = await nmcli(['connection', 'up', 'uuid', uuid], 60_000)
      if (!naik.ok) return { ok: false, message: 'Gagal menyambung: ' + pesanError(naik) }
      const trial = lama
        ? mulaiTrial({ uuidBaru: uuid, ssidBaru: profil.ssid, uuidLama: lama.uuid, ssidLama: lama.ssid })
        : null
      return { ok: true, uuid, trial }
    }

    if (action === 'autoconnect') {
      const nilaiBaru = nilai === true || nilai === '1' || nilai === 'yes'
      const r = await nmcli(['connection', 'modify', 'uuid', uuid, 'connection.autoconnect', nilaiBaru ? 'yes' : 'no'], 15_000)
      if (!r.ok) return { ok: false, message: pesanError(r) }
      return { ok: true, autoconnect: nilaiBaru }
    }

    if (action === 'utama') {
      // Prioritas tinggi = dipilih lebih dulu saat boot. Profil lain diturunkan.
      for (const p of semua.profil) {
        const pri = p.uuid === uuid ? 10 : 0
        await nmcli(['connection', 'modify', 'uuid', p.uuid, 'connection.autoconnect-priority', String(pri)], 15_000)
      }
      await nmcli(['connection', 'modify', 'uuid', uuid, 'connection.autoconnect', 'yes'], 15_000)
      return { ok: true, utama: true }
    }

    if (action === 'delete') {
      if (profil.aktif) return { ok: false, message: 'Profil sedang dipakai — sambungkan ke profil lain dulu' }
      const r = await nmcli(['connection', 'delete', 'uuid', uuid], 20_000)
      if (!r.ok) return { ok: false, message: pesanError(r) }
      return { ok: true, deleted: true }
    }

    return { ok: false, message: 'Aksi profil tidak dikenal' }
  }

  return {
    statusJaringan,
    pindaiWifi,
    daftarProfil: profilSemua,
    sambungWifi,
    aksiProfil,
    konfirmasiTrial,
    batalkanTrial,
    pulihkanTrial,
    // untuk tes
    _bacaState: bacaState
  }
}

// Service default dipakai handler (satu instance per proses server).
let layanan = null
export function layananWifi() {
  if (!layanan) layanan = buatService()
  return layanan
}

export const statusJaringan = (...a) => layananWifi().statusJaringan(...a)
export const pindaiWifi = (...a) => layananWifi().pindaiWifi(...a)
export const daftarProfil = (...a) => layananWifi().daftarProfil(...a)
export const sambungWifi = (...a) => layananWifi().sambungWifi(...a)
export const aksiProfil = (...a) => layananWifi().aksiProfil(...a)
export const konfirmasiTrial = (...a) => layananWifi().konfirmasiTrial(...a)
export const batalkanTrial = (...a) => layananWifi().batalkanTrial(...a)
export const pulihkanTrial = (...a) => layananWifi().pulihkanTrial(...a)
