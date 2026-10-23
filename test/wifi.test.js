// Tes modul WiFi lokal (src/local/wifi.mjs).
// Tidak menyentuh nmcli sungguhan: runner di-inject lewat buatService().
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validasiSsid, validasiPassword, pecahTerse, parseScan, parseDevices, parseIp4,
  bangunKeyfile, buatService, TRIAL_MS
} from '../src/local/wifi.mjs'

describe('wifi - validasi', () => {
  it('SSID wajib diisi dan maksimal 32 byte', () => {
    expect(validasiSsid('').ok).toBe(false)
    expect(validasiSsid('   ').ok).toBe(false)
    expect(validasiSsid('x'.repeat(33)).ok).toBe(false)
    expect(validasiSsid('x'.repeat(32)).ok).toBe(true)
  })

  it('SSID multibyte dihitung per byte', () => {
    // "é" = 2 byte; 17 karakter = 34 byte
    expect(validasiSsid('é'.repeat(17)).ok).toBe(false)
    expect(validasiSsid('é'.repeat(16)).ok).toBe(true)
  })

  it('SSID menolak spasi di awal/akhir dan karakter kontrol', () => {
    expect(validasiSsid(' Masjid').ok).toBe(false)
    expect(validasiSsid('Masjid ').ok).toBe(false)
    expect(validasiSsid('Mas\u0007jid').ok).toBe(false)
  })

  it('password WPA: 8-63 karakter atau 64 hex', () => {
    expect(validasiPassword('1234567', true).ok).toBe(false)
    expect(validasiPassword('12345678', true).ok).toBe(true)
    expect(validasiPassword('a'.repeat(63), true).ok).toBe(true)
    expect(validasiPassword('abcdef0123456789'.repeat(4), true).ok).toBe(true) // 64 hex
    // 64 karakter non-hex ditolak (batas WPA passphrase 63)
    expect(validasiPassword('z'.repeat(64), true).ok).toBe(false)
  })

  it('jaringan terbuka tidak boleh diberi password', () => {
    expect(validasiPassword('', false).ok).toBe(true)
    expect(validasiPassword('rahasia123', false).ok).toBe(false)
  })
})

describe('wifi - parser output nmcli', () => {
  it('pecahTerse memecah field dan meng-unescape ":"', () => {
    expect(pecahTerse('a:b:c')).toEqual(['a', 'b', 'c'])
    expect(pecahTerse('Masjid\\: Baitussalam:80:WPA2')).toEqual(['Masjid: Baitussalam', '80', 'WPA2'])
  })

  it('parseScan membuang SSID kosong dan mengambil sinyal terkuat', () => {
    const out = [
      ' :Masjid:40:WPA2',
      ' :Masjid:80:WPA2',
      ' :Tetangga:30:',
      ' :Tersembunyi::WPA2'.replace('Tersembunyi', ''),
      '*:Aktif:55:WPA2'
    ].join('\n')
    const hasil = parseScan(out)
    const masjid = hasil.find((j) => j.ssid === 'Masjid')
    expect(masjid.sinyal).toBe(80)
    expect(masjid.terbuka).toBe(false)
    expect(hasil[0].ssid).toBe('Aktif') // IN-USE diprioritaskan
    expect(hasil.find((j) => j.ssid === 'Tetangga').terbuka).toBe(true)
    expect(hasil.some((j) => !j.ssid)).toBe(false)
  })

  it('parseDevices membaca DEVICE,TYPE,STATE,CONNECTION', () => {
    const out = 'eth0:ethernet:connected:Ethernet connection 1\nwlan0:wifi:disconnected:'
    expect(parseDevices(out)).toEqual([
      { device: 'eth0', tipe: 'ethernet', state: 'connected', koneksi: 'Ethernet connection 1' },
      { device: 'wlan0', tipe: 'wifi', state: 'disconnected', koneksi: '' }
    ])
  })

  it('parseIp4 mengambil alamat tanpa prefix', () => {
    expect(parseIp4('IP4.ADDRESS[1]:192.168.1.20/24\nIP4.GATEWAY:192.168.1.1')).toBe('192.168.1.20')
    expect(parseIp4('')).toBe('')
  })
})

describe('wifi - keyfile', () => {
  it('menulis psk dan menonaktifkan autoconnect selama masa uji', () => {
    const isi = bangunKeyfile({
      uuid: '11111111-2222-3333-4444-555555555555',
      ssid: 'Masjid Baitussalam',
      password: 'rahasia123',
      hidden: true,
      autoconnect: false,
      nama: 'Masjid Baitussalam'
    })
    expect(isi).toContain('ssid=Masjid Baitussalam')
    expect(isi).toContain('psk=rahasia123')
    // NM 1.10 hanya mengerti true/false (yes/no diabaikan diam-diam)
    expect(isi).toContain('hidden=true')
    expect(isi).toContain('autoconnect=false')
    expect(isi).not.toContain('hidden=yes')
    expect(isi).not.toContain('autoconnect=no')
    expect(isi).not.toContain('\r')
  })

  it('jaringan terbuka tidak menulis blok wifi-security', () => {
    const isi = bangunKeyfile({ uuid: 'x', ssid: 'Publik', password: '', hidden: false })
    expect(isi).not.toContain('[wifi-security]')
    expect(isi).toContain('hidden=false')
  })
})

// ---------------------------------------------------------------------------
// Service dengan runner palsu
// ---------------------------------------------------------------------------
function buatFakeExec(handler) {
  const calls = []
  const fn = (cmd, args, opts, cb) => {
    calls.push({ cmd, args: [...args] })
    const hasil = handler(cmd, args)
    if (hasil instanceof Error) cb(hasil, '', hasil.message)
    else cb(null, hasil || '', '')
  }
  fn.calls = calls
  return fn
}

describe('wifi - service', () => {
  let dir
  let stateFile

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wifi-test-'))
    stateFile = join(dir, 'wifi-trial.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // Fake nmcli: profil lama "Rumah" aktif, semua perintah sukses.
  function fakeNmcli({ aktifUuid = 'aaaaaaaa-1111-2222-3333-444444444444' } = {}) {
    return buatFakeExec((cmd, args) => {
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('connection') && args.includes('show') && args.includes('--active')) {
        return aktifUuid + ':wlan0\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('device') && args.includes('status')) {
        return 'eth0:ethernet:connected:Ethernet connection 1\nwlan0:wifi:connected:Rumah\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('connection') && args.includes('show')) {
        return [
          'Rumah:aaaaaaaa-1111-2222-3333-444444444444:802-11-wireless:yes',
          'Kantor:bbbbbbbb-1111-2222-3333-444444444444:802-11-wireless:no'
        ].join('\n')
      }
      // detail profil
      if (cmd === 'nmcli' && args[0] === '-t' && args[2] === 'connection' && args[3] === 'show') {
        const uuid = args[5]
        const ssid = uuid.startsWith('aaaa') ? 'Rumah' : 'Kantor'
        return '802-11-wireless.ssid:' + ssid + '\nconnection.autoconnect-priority:0\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('wifi') && args.includes('list')) {
        return '*:Rumah:70:WPA2\n :Kantor:40:WPA2\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('IP4.ADDRESS')) {
        return 'IP4.ADDRESS[1]:192.168.1.30/24\n'
      }
      if (cmd === 'tailscale') return '100.69.45.47\n'
      if (cmd === 'ping') return ''
      return ''
    })
  }

  it('statusJaringan merangkum wlan, ethernet, tailscale, internet', async () => {
    const exec = fakeNmcli()
    const svc = buatService({ execFileFn: exec, stateFile, now: () => 1000 })
    const st = await svc.statusJaringan()
    expect(st.ok).toBe(true)
    expect(st.wlan.terhubung).toBe(true)
    expect(st.wlan.ssid).toBe('Rumah')
    expect(st.wlan.ip).toBe('192.168.1.30')
    expect(st.ethernet.terhubung).toBe(true)
    expect(st.tailscale.ip).toBe('100.69.45.47')
    expect(st.internet).toBe(true)
    expect(st.trial).toBeNull()
  })

  it('pindaiWifi mengembalikan daftar jaringan', async () => {
    const svc = buatService({ execFileFn: fakeNmcli(), stateFile, now: () => 1000 })
    const r = await svc.pindaiWifi()
    expect(r.ok).toBe(true)
    expect(r.jaringan.map((j) => j.ssid)).toEqual(['Rumah', 'Kantor'])
  })

  it('sambungWifi menulis keyfile lewat connection load (password tidak di argv)', async () => {
    const exec = fakeNmcli()
    const svc = buatService({ execFileFn: exec, stateFile, now: () => 1000 })
    const r = await svc.sambungWifi({ ssid: 'Kantor', password: 'rahasia123', hidden: false })
    expect(r.ok).toBe(true)
    expect(r.trial).toBeTruthy()
    const semuaArg = exec.calls.flatMap((c) => c.args).join(' ')
    expect(semuaArg).not.toContain('rahasia123')
    expect(exec.calls.some((c) => c.args.includes('load'))).toBe(true)
    expect(exec.calls.some((c) => c.args.includes('up') && c.args.includes(r.uuid))).toBe(true)
  })

  it('sambungWifi dengan sambung=false hanya menyimpan profil', async () => {
    const exec = fakeNmcli()
    const svc = buatService({ execFileFn: exec, stateFile, now: () => 1000 })
    const r = await svc.sambungWifi({ ssid: 'Kantor', password: 'rahasia123', hidden: true, sambung: false })
    expect(r.ok).toBe(true)
    expect(r.disimpan).toBe(true)
    expect(r.trial).toBeUndefined()
    expect(exec.calls.some((c) => c.args.includes('up'))).toBe(false)
  })

  it('trial: batalkan mengembalikan profil lama dan menghapus profil baru', async () => {
    const exec = fakeNmcli()
    let clock = 1000
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const r = await svc.sambungWifi({ ssid: 'Kantor', password: 'rahasia123' })
    clock += 10
    const batal = await svc.batalkanTrial(r.trial.token)
    expect(batal.ok).toBe(true)
    expect(batal.reverted).toBe(true)
    expect(existsSync(stateFile)).toBe(false)
    const arg = exec.calls.map((c) => c.args.join(' '))
    expect(arg.some((a) => a.includes('up uuid aaaaaaaa-1111-2222-3333-444444444444'))).toBe(true)
    expect(arg.some((a) => a.includes('delete uuid ' + r.uuid))).toBe(true)
  })

  it('trial: konfirmasi mengaktifkan autoconnect dan menghapus state', async () => {
    const exec = fakeNmcli()
    let clock = 1000
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const r = await svc.sambungWifi({ ssid: 'Kantor', password: 'rahasia123' })
    clock += 5
    const ok = await svc.konfirmasiTrial(r.trial.token)
    expect(ok.ok).toBe(true)
    expect(existsSync(stateFile)).toBe(false)
    const arg = exec.calls.map((c) => c.args.join(' '))
    expect(arg.some((a) => a.includes('connection.autoconnect yes'))).toBe(true)
  })

  it('trial: konfirmasi setelah deadline ditolak', async () => {
    const exec = fakeNmcli()
    let clock = 1000
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const r = await svc.sambungWifi({ ssid: 'Kantor', password: 'rahasia123' })
    clock += TRIAL_MS + 1
    const hasil = await svc.konfirmasiTrial(r.trial.token)
    expect(hasil.ok).toBe(false)
    expect(hasil.message).toMatch(/Waktu konfirmasi/)
  })

  it('pulihkanTrial mengembalikan koneksi bila deadline lewat dan WiFi baru mati', async () => {
    // Status wlan disconnected → ujiWifiHidup false
    const exec = buatFakeExec((cmd, args) => {
      if (cmd === 'nmcli' && args.includes('device') && args.includes('status')) {
        // ujiWifiHidup memakai -f DEVICE,STATE (2 field)
        if (args.includes('DEVICE,STATE')) return 'eth0:connected\nwlan0:disconnected\n'
        return 'eth0:ethernet:connected:Ethernet connection 1\nwlan0:wifi:disconnected:\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('IP4.ADDRESS')) return ''
      return ''
    })
    let clock = 1000
    writeFileSync(stateFile, JSON.stringify({
      token: 'cccccccc-1111-2222-3333-444444444444',
      uuidBaru: 'dddddddd-1111-2222-3333-444444444444',
      ssidBaru: 'Baru',
      uuidLama: 'aaaaaaaa-1111-2222-3333-444444444444',
      ssidLama: 'Rumah',
      deadline: clock + TRIAL_MS
    }))
    clock += TRIAL_MS + 1
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const r = await svc.pulihkanTrial()
    expect(r.ok).toBe(true)
    expect(r.hasil).toBe('dikembalikan')
    expect(existsSync(stateFile)).toBe(false)
  })

  it('pulihkanTrial mengonfirmasi otomatis bila profil BARU aktif dan punya IP', async () => {
    const exec = buatFakeExec((cmd, args) => {
      if (cmd === 'nmcli' && args.includes('--active')) {
        // profil baru (dddd…) aktif di wlan0
        return 'dddddddd-1111-2222-3333-444444444444:wlan0\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('connection') && args.includes('show')) {
        return [
          'Baru:dddddddd-1111-2222-3333-444444444444:802-11-wireless:no',
          'Rumah:aaaaaaaa-1111-2222-3333-444444444444:802-11-wireless:yes'
        ].join('\n')
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args[2] === 'connection' && args[3] === 'show') {
        return '802-11-wireless.ssid:Baru\nconnection.autoconnect-priority:0\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('IP4.ADDRESS')) {
        return 'IP4.ADDRESS[1]:192.168.1.99/24\n'
      }
      return ''
    })
    let clock = 1000
    writeFileSync(stateFile, JSON.stringify({
      token: 'cccccccc-1111-2222-3333-444444444444',
      uuidBaru: 'dddddddd-1111-2222-3333-444444444444',
      ssidBaru: 'Baru',
      uuidLama: 'aaaaaaaa-1111-2222-3333-444444444444',
      ssidLama: 'Rumah',
      deadline: clock + TRIAL_MS
    }))
    clock += TRIAL_MS + 1
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const r = await svc.pulihkanTrial()
    expect(r.hasil).toBe('dikonfirmasi-otomatis')
    expect(existsSync(stateFile)).toBe(false)
  })

  it('pulihkanTrial TIDAK mengonfirmasi bila yang aktif profil lama (wlan hidup)', async () => {
    // Kasus bug: wlan0 connected + punya IP, tapi profil baru gagal dan NM
    // sudah kembali ke profil lama. Jangan anggap trial sukses.
    const exec = buatFakeExec((cmd, args) => {
      if (cmd === 'nmcli' && args.includes('--active')) {
        return 'aaaaaaaa-1111-2222-3333-444444444444:wlan0\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('connection') && args.includes('show')) {
        return [
          'Baru:dddddddd-1111-2222-3333-444444444444:802-11-wireless:no',
          'Rumah:aaaaaaaa-1111-2222-3333-444444444444:802-11-wireless:yes'
        ].join('\n')
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args[2] === 'connection' && args[3] === 'show') {
        return '802-11-wireless.ssid:Rumah\nconnection.autoconnect-priority:0\n'
      }
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('IP4.ADDRESS')) {
        return 'IP4.ADDRESS[1]:192.168.1.30/24\n'
      }
      return ''
    })
    let clock = 1000
    writeFileSync(stateFile, JSON.stringify({
      token: 'cccccccc-1111-2222-3333-444444444444',
      uuidBaru: 'dddddddd-1111-2222-3333-444444444444',
      ssidBaru: 'Baru',
      uuidLama: 'aaaaaaaa-1111-2222-3333-444444444444',
      ssidLama: 'Rumah',
      deadline: clock + TRIAL_MS
    }))
    clock += TRIAL_MS + 1
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const r = await svc.pulihkanTrial()
    expect(r.hasil).toBe('dikembalikan')
  })

  it('revert trial dari profil tersimpan TIDAK menghapus profil pengguna', async () => {
    // Aktifkan profil tersimpan yang sudah ada (bukan hasil input baru).
    const exec = fakeNmcli()
    let clock = 1000
    const svc = buatService({ execFileFn: exec, stateFile, now: () => clock, setTimer: () => 1 })
    const hasil = await svc.aksiProfil({
      uuid: 'bbbbbbbb-1111-2222-3333-444444444444',
      action: 'activate'
    })
    expect(hasil.ok).toBe(true)
    expect(hasil.trial).toBeTruthy()
    clock += 5
    const batal = await svc.batalkanTrial(hasil.trial.token)
    expect(batal.ok).toBe(true)
    const arg = exec.calls.map((c) => c.args.join(' '))
    // tidak boleh ada delete untuk profil yang diaktifkan (bbbb…)
    expect(arg.some((a) => a.includes('delete uuid bbbbbbbb'))).toBe(false)
    // profil lama (aaaa…) harus dihidupkan kembali
    expect(arg.some((a) => a.includes('up uuid aaaaaaaa'))).toBe(true)
  })

  it('sambungWifi fallback ke helper sudo saat nmcli load ditolak polkit', async () => {
    const calls = []
    const exec = (cmd, args, opts, cb) => {
      calls.push({ cmd, args: [...args] })
      if (cmd === 'nmcli' && args.includes('load')) {
        return cb(Object.assign(new Error('access denied'), { code: 1 }), '', 'Error: failed to load connection: access denied.')
      }
      if (cmd === 'sudo') {
        // File harus masih ada saat helper dipanggil (bug finally tanpa await).
        const path = args[args.length - 1]
        expect(existsSync(path)).toBe(true)
        return cb(null, 'ok 11111111-2222-3333-4444-555555555555\n', '')
      }
      if (cmd === 'nmcli' && args.includes('show') && args.includes('--active')) return cb(null, '', '')
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('connection') && args.includes('show')) return cb(null, '', '')
      if (cmd === 'nmcli' && args[0] === '-t' && args.includes('device') && args.includes('status')) {
        return cb(null, 'wlan0:wifi:disconnected:\n', '')
      }
      cb(null, '', '')
    }
    const svc = buatService({ execFileFn: exec, stateFile, now: () => 1000, setTimer: () => 1 })
    const r = await svc.sambungWifi({ ssid: 'Kantor', password: 'rahasia123', sambung: false })
    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.cmd === 'sudo' && c.args[1] === '/usr/local/bin/jam-masjid-wifi-load')).toBe(true)
  })

  it('aksiProfil menolak UUID asing dan aksi tidak dikenal', async () => {
    const svc = buatService({ execFileFn: fakeNmcli(), stateFile, now: () => 1000 })
    expect((await svc.aksiProfil({ uuid: 'x', action: 'delete' })).ok).toBe(false)
    const r = await svc.aksiProfil({ uuid: 'aaaaaaaa-1111-2222-3333-444444444444', action: 'nuklir' })
    expect(r.message).toBe('Aksi profil tidak dikenal')
  })

  it('aksiProfil delete menolak profil yang sedang aktif', async () => {
    const svc = buatService({ execFileFn: fakeNmcli(), stateFile, now: () => 1000 })
    const r = await svc.aksiProfil({ uuid: 'aaaaaaaa-1111-2222-3333-444444444444', action: 'delete' })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/sedang dipakai/)
  })
})
