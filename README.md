# Jam Masjid Santrimu

Jam digital & jadwal sholat untuk layar masjid. Mendukung dua mode runtime:

| Mode | Runtime | Storage | Realtime | Kegunaan |
|---|---|---|---|---|
| **Lokal (mandiri)** | `bun src/server.mjs` | file `db/database.json` | SSE hub in-process | PC/Armbian di masjid, offline-first |
| **Cloudflare Workers** | `wrangler deploy` | KV namespace | Durable Object `DisplayHub` | hosting publik |

Kedua mode berbagi seluruh handler (`src/lib/*`) dan aset klien; hanya binding infrastruktur yang diganti via adapter.

## Fitur

**Layar display (`GET /`)**

- Jadwal sholat 5 waktu + Shuruq. Sumber waktu berlapis:
  1. **Jadwal resmi Kemenag** (`db.jadwal_resmi`) bila sinkron aktif dan tanggal tersedia.
  2. Fallback **PrayTimes.js** di browser (koordinat & koreksi dari db) — display tetap akurat walau offline.
- Pipeline otomatis tiap waktu sholat: *Menuju Adzan* (countdown flip-digit, `timer.wait_adzan` menit) → *Adzan* (overlay, `timer.adzan` menit + beep) → *Iqomah* (countdown per-sholat `iqomah`; khusus Jumat+Dzuhur+`jumat.active` diganti overlay khutbah) → tampilan utama + beep.
- Jam besar dengan detik, tanggal Indonesia, nama masjid (font logo), **logo opsional kiri/kanan nama masjid** (upload dari admin; tanpa logo, kiri saja, kanan saja, atau keduanya), running text (animasi CSS), segmen **KAS MASJID** otomatis disembunyikan bila kosong.
- Update realtime: SSE `GET /api/events` → reload saat db berubah; fallback hash-check 5 menit (`changeDbCheck`); watchdog reload harian 13:00–14:00 hanya bila koneksi server terbukti hidup (< 2 jam sejak check sukses) sehingga layar tidak pernah blank saat server/internet mati.
- UI responsif TV/desktop & mobile portrait; `noindex/nofollow`; PWA manifest.

**Auto-adjust jadwal Kemenag (mode lokal)**

- `src/lib/scheduler.mjs`: saat server start (bila data hari ini belum ada) dan **1× per hari pukul 04:30**, bila `kemenag.active` dan PC online → `src/lib/kemenag.js` mengambil jadwal **3 bulan ke depan** (bulan berjalan + 2 berikutnya), dinormalisasi, disimpan ke `db.jadwal_resmi`, lalu broadcast SSE `db-changed` → semua layar reload memakai jam resmi.
- Retensi otomatis: tanggal usang (< hari ini) dibuang saat save, sehingga storage selalu bergulir ~3 bulan (± 90 hari ≈ 15 KB), tidak menumpuk.
- Sesi: `HEAD /jadwalshalat` → cookie `PHPSESSID` → `POST /ajax/getShalatbln` (form `x`=hash provinsi, `y`=hash kabupaten/kota, `bln`, `thn`, header `X-Requested-With: XMLHttpRequest` wajib). Respons "Illegal Key" → refresh sesi, retry sekali. Error jaringan → dicatat, display tidak terganggu.
- Admin menyediakan dropdown 38 provinsi + kabupaten/kota (endpoint `kemenagKabkota` → `POST /ajax/getKabkoshalat`) sehingga ID hash tidak perlu dicari manual.

**Dashboard admin (`/admin/`)**

- Login session cookie HMAC-SHA256 stateless (secret `AUTH_SECRET`, TTL 7 hari).
- Edit: info/lokasi masjid, metode perhitungan & koreksi (adjust/tune), timer adzan/iqomah/menunggu, running text, kas masjid, jadwal Jumat, Kemenag (wilayah + toggle + sinkron manual), ganti password, reset pabrik.
- Semua mutasi → simpan db → `notifyHub()` → layar reload.

## Arsitektur

```
src/server.mjs           → server lokal Bun (node:http): router + static public/ + SSE
src/worker.js            → entrypoint Cloudflare Workers (route identik)
src/local/env.mjs        → adapter env lokal: KV→file JSON (tulis atomik), HUB→SSE in-process, .env loader
src/displayHub.js        → Durable Object SSE (hanya mode Workers)
src/lib/
  render.js              → render template + inject db (template di-pass: wrangler Rules / fs)
  proses.js              → API POST /api/proses (login, formSave, syncKemenag, kemenagKabkota, dll)
  db.js                  → getDb (merge dangkal dengan DEFAULT_DB), putDb, hashDb (sha1)
  auth.js                → session cookie HMAC-SHA256
  kemenag.js             → klien bimasislam.kemenag.go.id (session, jadwal bulanan, normalisasi)
  jadwalStore.js         → storage jadwal resmi (satu file db/jadwal-sholat.json / KV jadwal-sholat)
  scheduler.mjs          → sinkron harian jadwal resmi (start bila perlu + 04:30)
src/templates/index.html → template display (placeholder __LAT__, __DB_JSON__, dst.)
public/                  → aset statis: admin SPA, masjid (jquery/moment/PrayTimes), font, img
db/database.json         → sumber data awal / storage mode lokal
deploy/masjid-display.service → unit systemd untuk autostart Linux/Armbian
test/                    → vitest (pipeline sholat, khutbah, flip-digit, watchdog, kemenag, scheduler, jadwal-resmi)
```

### Pemetaan binding Cloudflare → lokal

| Cloudflare | Lokal (`src/local/env.mjs`) |
|---|---|
| KV `DATABASE` (dokumen konfigurasi) | baca/tulis `db/database.json` (write tmp + rename atomik) |
|  KV `jadwal-sholat` (jadwal resmi)| file `db/jadwal-sholat.json` |
| Durable Object `HUB` (`DisplayHub`) | `Set<http.ServerResponse>` + heartbeat 30 dtk; antarmuka `idFromName/get().notify()` dipertahankan agar `proses.js` tak berubah |
| `ASSETS` + `run_worker_first` | static file server + `Cache-Control: 30 hari` untuk media |
| Secret `AUTH_SECRET` | env var / `.env` (loader minimal tanpa dependensi) |
| Wrangler Rules text-import `*.html` | `fs.readFileSync` di `server.mjs`, di-pass ke `renderDisplay(env, template)` |
| `caches.default` invalidasi | di-skip lokal (best-effort no-op di `proses.js`) |

## Persyaratan

- Bun ≥ 1.1 (https://bun.sh) — runtime lokal utama
- akun Cloudflare — **hanya** untuk mode Workers

## Development

```sh
bun install
cp .env.example .env      # ganti AUTH_SECRET & ADMIN_PASS; atur PORT bila perlu (default 11111)
bun run start             # http://localhost:11111
```

- Display: `http://localhost:$PORT/` · Admin: `http://localhost:$PORT/admin/`.
- **Login admin** memakai user `admin` dan password `ADMIN_PASS` dari `.env`.
  Password **tidak disimpan di repo** (`db/database.json` → `akses.pass` kosong).
- **Login ditolak selama password masih `admin1234`** (default). Ganti dulu:
  - isi `ADMIN_PASS` di `.env` dengan password kuat (≥8 karakter), **atau**
  - setelah login dengan `ADMIN_PASS` yang sudah diganti, gunakan admin →
    *Ganti password*. Password baru disimpan di `db.akses.pass` dan mengalahkan
    nilai env. Password default `admin1234` tidak diizinkan.
- `src/lib/*` adalah ES modules murni Web API (Request/Response) — identik di Workers dan Bun, sehingga seluruh logika ter-cover oleh vitest tanpa mock berat.
- Mode Wrangler (untuk menguji binding CF lokal): `bun run seed` lalu `bun run dev`.

### Testing

```sh
bun run test
```

16 file suite regresi: pipeline 5 waktu sholat, matriks khutbah Jumat, flip-digit monotonik, running text, auth HMAC, proses API, watchdog, SSE hub, serta klien Kemenag (mock fetch: cookie, Illegal Key retry, normalisasi tanggal `Kamis, 01/10/2026` → ISO), scheduler (offline-safe, tidak merusak db), dan prioritas `jadwal_resmi` di display harness. `uji-real-waktu.test.js` skip otomatis kecuali `UJI_MODE=real|sim` diset:

```sh
UJI_MODE=sim bun run test   # simulasi jam standar (SIM_PRAYER_TIMES)
```

Catatan: mode `sim` memakai jadwal tetap `SIM_PRAYER_TIMES` di `test/display-harness.js`; `UJI_JAM` harus sama dengan nilai itu untuk `UJI_PRAYER` yang dipilih, jika tidak pengujian gagal cepat dengan pesan yang jelas.

## Production — PC lokal / Armbian

### Instalasi otomatis (disarankan)

Untuk Armbian Desktop / Debian / Ubuntu. Skrip mengurus sistem & aplikasi.

```sh
# 1. Ambil repo
git clone https://github.com/sdldev/jammasjid.git ~/jammasjid
cd ~/jammasjid

# 2. Jalankan installer (butuh root)
sudo bash scripts/install.sh
```

Yang dilakukan `install.sh`:
1. Cek root, OS Debian/Ubuntu, arsitektur, dan koneksi internet
2. `apt update` + `apt upgrade`
3. Pembersihan konservatif: `autoremove`, `clean`, hapus paket berat yang tidak
   dipakai display (LibreOffice, Thunderbird, game GNOME)
4. Pasang dependensi: `curl`, `git`, `ca-certificates`, `unzip`, `jq`, `rsync`,
   utilitas X, dan **Chromium** (apt, atau snap bila tidak tersedia di apt)
5. Pasang **Bun** bila belum ada
6. Clone/pull repo ke `/opt/jam-masjid`
7. `bun install --frozen-lockfile --production`
8. Buat `.env` berisi `AUTH_SECRET` acak + `ADMIN_PASS=admin1234`
9. Pasang & aktifkan `masjid-display.service` + `masjid-kiosk.service`
10. Verifikasi HTTP sampai server benar-benar merespons

Opsi:

| Opsi | Keterangan |
|---|---|
| `--user NAMA` | user pemilik sesi desktop untuk Chromium (default: deteksi otomatis) |
| `--dir PATH` | lokasi aplikasi (default `/opt/jam-masjid`) |
| `--branch NAMA` | branch git (default `main`) |
| `--port N` | port server (default `11111`) |
| `--skip-upgrade` | lewati `apt upgrade` |
| `--skip-cleanup` | lewati pembersihan apt |

Skrip **idempoten** — aman dijalankan ulang; `.env` yang sudah ada tidak ditimpa.

> Login admin memakai user `admin` dan `ADMIN_PASS` dari `.env`.
> **Password default `admin1234` ditolak** — ganti dulu lewat admin →
> *Ganti password*, lalu `ADMIN_PASS` di `.env` tidak lagi dipakai.

### Update

```sh
sudo bash /opt/jam-masjid/scripts/update.sh
```

`update.sh` mengambil commit terbaru, `bun install`, lalu restart service.
Bila update gagal, repo **di-rollback otomatis** ke commit sebelumnya
termasuk memulihkan `db/` dan `.env` dari backup.

Skrip ini aman dijalankan walau working tree kotor:

- File **data/runtime** (`db/*`, `.env`, `public/img/logo-*`) yang berubah
  saat aplikasi berjalan otomatis dibackup lalu dibersihkan, dan
  **dipulihkan kembali** setelah update (isi db lama tetap terbaca karena
  `getDb` shallow-merge dengan `DEFAULT_DB`).
- Modifikasi **file kode** di STB otomatis di-`git stash` dengan pesan
  ber-timestamp — tidak hilang; pulihkan dengan `git stash pop`.

| Opsi | Keterangan |
|---|---|
| `--no-restart` | update kode saja, tanpa restart |
| `--no-backup` | lewati backup (tidak disarankan) |
| `--branch NAMA` | branch git (default `main`) |

Backup selalu dibuat otomatis ke `/var/backups/jam-masjid/<waktu>/`
(db, `.env`, commit hash; dirotasi 10 run terbaru).

Catatan: unit systemd yang sudah terpasang **tidak ditimpa** otomatis; bila
template di `deploy/` berubah, skrip memberi peringatan agar Anda membandingkan
manual.

Update juga bisa dijalankan dari dashboard admin: **Lainnya → Update sistem →
Perbarui sekarang** (hanya mode lokal/STB; memerlukan login admin). Tampilannya
mem-poll log `update.sh` real-time; server me-restart otomatis setelah selesai
— halaman admin perlu dimuat ulang.

### Instalasi manual (alternatif)

```sh
sudo mkdir -p /opt/jam-masjid && sudo cp -r . /opt/jam-masjid
cd /opt/jam-masjid && bun install --production --frozen-lockfile
cp .env.example .env      # isi AUTH_SECRET & ADMIN_PASS

sudo cp deploy/masjid-display.service deploy/masjid-kiosk.service /etc/systemd/system/
sudo systemctl enable --now masjid-display masjid-kiosk
journalctl -u masjid-display -f
```

### Kiosk browser (Chromium)

Perintah lengkap yang direkomendasikan untuk STB/kiosk:

```sh
chromium --kiosk --force-device-scale-factor=1 --start-fullscreen \
  --window-position=0,0 --log-level=3 --disable-gpu --disable-pinch \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=Translate,TranslateUI \
  --lang=id-ID --accept-lang=id-ID,id \
  --disable-component-update --disable-notifications \
  --no-first-run --no-default-browser-check \
  --user-data-dir=/opt/jam-masjid/.chrome-kiosk \
  http://localhost:11111/
```

Autostart via systemd: gunakan `deploy/masjid-kiosk.service` (sudah berisi flag
yang sama, plus `ExecStartPre` menunggu server siap).

#### Sesi grafis minimal (xinit + openbox)

STB display tidak membutuhkan desktop environment. `install.sh` memasang
**xinit + openbox** menggantikan lightdm/XFCE:

- `masjid-x.service` (root) menjalankan X di `:0`/vt1 + openbox sebagai user kiosk.
- `masjid-kiosk.service` menunggu X siap (`Requires=masjid-x` + cek `xdpyinfo`).
- `getty@tty1` di-mask (X memakai vt1); **tty2 tetap aktif** untuk recovery
  (Ctrl+Alt+F2 di keyboard).
- Kursor disembunyikan: `unclutter` (hilang setelah 0,5 dtk diam) + parkir pojok
  via `xdotool`. Bergerakkan mouse memunculkannya kembali.
- Boot default: `multi-user.target` (bukan graphical). lightdm dinonaktifkan.

Rollback ke desktop penuh (selama paket xfce4/lightdm belum di-purge):

```sh
sudo systemctl disable masjid-x masjid-kiosk
sudo systemctl enable lightdm
sudo systemctl set-default graphical.target && sudo reboot
```

#### Penjelasan setiap flag

| Flag | Kenapa perlu |
|---|---|
| `--kiosk` | Layar penuh tanpa UI browser (tab bar, address bar, tombol tutup). |
| `--force-device-scale-factor=1` | Kunci skala di 100% — mencegah tampilan "kadang tidak fullscreen" saat TV/HDMI bernegosiasi ulang. |
| `--start-fullscreen --window-position=0,0` | Pastikan jendela menutupi layar dari koordinat awal. |
| `--disable-gpu` | STB Amlogic tanpa dri3: GPU process gagal terus-menerus. Software render (SwiftShader) lebih stabil; halaman jam adalah teks ringan. |
| `--log-level=3` | Hanya fatal error ke journal — redam noise UPower/D-Bus. |
| `--disable-pinch` | Nonaktifkan zoom pinch pada layar sentuh. |
| `--autoplay-policy=no-user-gesture-required` | **Wajib.** Beep adzan/iqomah berbunyi tanpa sentuhan pengguna. Tanpa flag ini browser memblokir audio otomatis. |
| `--disable-features=Translate,TranslateUI` | **Mematikan notifikasi "Terjemahkan halaman ini?"**. Halaman ber-`lang="id"`; tanpa flag ini Chrome menawarkan terjemahan bila locale browser berbeda. |
| `--lang=id-ID --accept-lang=id-ID,id` | Browser berbahasa Indonesia → tidak ada tawaran terjemahan yang tersisa. |
| `--disable-component-update` | **Menghentikan balon "Chrome versi baru tersedia"** dari updater komponen. |
| `--disable-notifications` | Cegah notifikasi sistem yang berasal dari web. |
| `--no-first-run --no-default-browser-check` | Cegah wizard awal & popup "jadikan browser default" di STB baru. |
| `--user-data-dir=/opt/jam-masjid/.chrome-kiosk` | Profil persisten, **bukan** `--incognito`. Cache aset 30 hari (CSS/JS) tetap bekerja sehingga restart tidak mengunduh ulang ~180 KB setiap kali. |

> **Catatan `--incognito`**: perintah lama memakai `--incognito`, yang membuang
> cache pada setiap start. Untuk kiosk yang jarang restart efeknya kecil, tetapi
> `--user-data-dir` lebih baik: profil terisolasi dari pengguna, cache tetap awet.

#### Menonaktifkan updater browser (opsional, lebih tuntas)

Balon update berasal dari service updater sistem, bukan dari halaman web:

```sh
# Chromium Debian/Ubuntu
sudo systemctl disable --now chromium-browser-update 2>/dev/null || true

# Chromium snap (hanya bila tidak dipakai aplikasi lain)
sudo snap refresh --hold chromium

# Google Chrome (.deb) — matikan update komponen via kebijakan
sudo mkdir -p /etc/opt/chrome/policies/managed
echo '{"ComponentUpdatesEnabled": false}' | sudo tee /etc/opt/chrome/policies/managed/kiosk.json
```

#### Mematikan layar / mencegah screen blanking

Aplikasi tidak mengendalikan layar. Untuk STB, matikan DPMS/screensaver di OS:

```sh
# X11
xset s off -dpms s noblank

# Wayland (cage/sway): atur di compositor, mis. idle-inhibit
```

### Waktu sistem (WAJIB, terutama STB tanpa RTC)

Aplikasi bergantung pada jam sistem yang benar. Atur **zona waktu Asia/Jakarta** dan aktifkan **NTP** agar jam tersinkron saat ada internet:

```sh
# Zona waktu
sudo timedatectl set-timezone Asia/Jakarta

# NTP aktif (sinkron jam otomatis saat online)
sudo timedatectl set-ntp true

# Verifikasi
timedatectl status
#   Time zone: Asia/Jakarta (WIB, +07:00)
#   System clock synchronized: yes
#   NTP service: active
```

Tanpa RTC, NTP adalah satu-satunya sumber jam saat boot — pastikan internet tersedia saat STB dinyalakan, atau gunakan offset tersimpan (lihat di bawah) sebagai cadangan.

### Konfigurasi runtime

| Variabel | Default | Keterangan |
|---|---|---|
| `AUTH_SECRET` | `dev-secret-ganti-di-file-env` | **Wajib diganti**; penanda tangan cookie admin |
| `ADMIN_PASS` | `admin1234` | password admin awal (user `admin`). **Login ditolak selama masih default**; ganti via `.env` atau menu Ganti password |
| `PORT` | `11111` | port HTTP server lokal |
| `kemenag.active/provid/kabkotid` | nonaktif | diisi via admin → *Jadwal resmi Kemenag* |
| `time_offset_ms` | `0` | selisih (waktu server Kemenag − jam lokal), ms. Diisi otomatis tiap sinkron; dipakai display untuk mengkoreksi jam STB **tanpa RTC** |

### Skenario STB tanpa RTC (Armbian, tanpa baterai jam)

Tanpa RTC, jam STB **reset saat mati listrik** — NTP-lah yang menyelamatkan, dan NTP butuh internet. Risiko: jika STB nyala saat internet sedang putus, jam bisa melenceng jauh dan seluruh jadwal salah. Mitigasi berlapis:

1. **Offset waktu tersimpan** (`time_offset_ms`): tiap sinkron Kemenag, server mengukur selisih jam lokal vs header HTTP `Date` situs Kemenag dan menyimpannya. Display menggeser **semua** pembacaan jam (`app.now()`) sebesar offset ini — jadi walau jam STB salah, tampilan tetap akurat selama offset terakhir masih valid (dipertahankan lewat restart karena tersimpan di db).
2. **Indikator koneksi**: titik hijau/merah di pojok kanan bawah display (`#net-status`). Merah = server/internet tak terjangkau → jam memakai offset tersimpan + jadwal cadangan. Operator bisa lihat sekilas tanpa membuka admin.
3. **Peringatan dua lapis saat offline**:
   - **Jam besar berubah merah** (`#jam.clock-offline`) — sinyal paling jelas, terlihat dari seluruh ruangan.
   - **Banner berkedip besar** (`#net-banner`) tepat di bawah jam + tanggal: **merah** "Tidak ada koneksi internet" saat offline; **oranye** "Jam perangkat salah, sudah dikoreksi otomatis" bila |offset| ≥ 1 jam (STB tanpa RTC melenceng jauh). Hilang otomatis saat pulih.
3. **Offline tetap jalan**: watchdog hanya reload bila internet terbukti hidup; tanpa internet, display tidak pernah blank — ia terus memakai offset + jadwal terakhir sampai koneksi pulih (lalu sinkron harian memperbarui offset dan jadwal).

Batasan jujur: offset hanya akurat **sejak sinkron terakhir**. Jika STB mati-listrik-lama **dan** offline di saat bersamaan, jam bisa melenceng sejauh drift sejak offset terakhir diukur. Ini risiko inheren perangkat tanpa RTC — satu-satunya solusi penuh adalah menambah modul RTC (mis. DS3231) atau memastikan NTP aktif saat boot.

## Production — Cloudflare Workers

```sh
bunx wrangler secret put AUTH_SECRET     # sekali
bunx wrangler secret put ADMIN_PASS      # password admin awal (jangan admin1234)
bun run seed -- --remote                 # isi KV remote dari db/database.json
bun run deploy
```

Pastikan `kv_namespaces.id` di `wrangler.jsonc` menunjuk KV namespace Anda (`bunx wrangler kv namespace create DATABASE`). Catatan: sinkron Kemenag otomatis hanya berjalan di mode lokal (scheduler in-process); di Workers, gunakan `syncKemenag` manual dari admin atau jadwalkan via cron trigger bila diperlukan.

## Struktur database (`db/database.json` / KV key `database`)

| Field | Isi |
|---|---|
| `akses` | `user` (admin) dan `pass` (kosong = pakai `ADMIN_PASS`; terisi setelah ganti password) |
| `setting` | nama, lokasi, latitude/longitude, timeZone, dst |
| `prayTimesMethod` / `prayTimesAdjust` / `prayTimesTune` | metode & koreksi perhitungan jadwal lokal |
| `prayName`, `timeName`, `dayName`, `monthName` | label tampilan (Indonesia) |
| `timer` | `wallpaper` (detik carousel), `wait_adzan` & `adzan` (menit) |
| `iqomah` | durasi iqomah per sholat (menit) |
| `jumat` | `active`, `duration`, `text` — mode khutbah Jumat |
| `running_text` | daftar teks berjalan |
| `logo` | `left`, `right` — URL logo opsional di sisi nama masjid (kosong = tanpa logo) |
| `kas` | `active`, `rekening`, `kas_bulan_lalu`, `pendapatan`, `pengeluaran` |
| `kemenag` | `active`, `provid`, `kabkotid` (hash ID Kemenag), `last_sync` (ISO) |

**Logo masjid (kiri/kanan judul)**: upload dari admin → menu *Display → Logo masjid* (PNG/JPG, maks 4 MB, per sisi). Mode lokal menyimpan file di `public/img/logo-{side}.{ext}`; mode Workers menyimpan base64 di KV dan menyajikannya lewat `GET /logo/{side}`. URL di db memakai `?v=` (cache-busting) karena media di-cache 30 hari; setelah seed lokal→Workers, upload ulang logo sekali di admin Workers.

**`jadwal_resmi` tidak lagi disimpan di dokumen ini.** Jadwal resmi hasil sinkron
adalah data berkala yang berubah tiap sinkron, jadi dipisah ke storage sendiri
(`src/lib/jadwalStore.js`):

| Mode | Lokasi | Format |
|---|---|---|
| Lokal | `db/jadwal-sholat.json` (satu file) | map `YYYY-MM-DD` → `{fajr, sunrise, dhuhr, asr, maghrib, isha}` |
| Workers | KV key `jadwal-sholat` | sama |

Isi selalu jendela bergulir ~3 bulan (tanggal usang dibuang saat save, ± 15 KB),
sehingga satu file cukup — tanpa pemecahan per tahun. `getDb/putDb` menempelkan/
memisahkan `jadwal_resmi` secara transparan, jadi display, admin, dan seluruh
handler tidak berubah. Migrasi dari format lama (inline di `database.json`)
terjadi otomatis saat pertama kali db dibaca.

## API ringkas

| Endpoint | Metode | Keterangan |
|---|---|---|
| `/` | GET | halaman display (db ter-inject) |
| `/api/proses` | POST | dispatcher `id`: `login`, `logout`, `changeDbCheck`, `readDatabase`, `formSave`, `formDelete`, `getPraySetting`, `syncKemenag`, `kemenagKabkota`, `resetDevice` — selalu HTTP 200 `{success, registered, data}` |
| `/api/events` | GET | SSE `db-changed`, `retry: 3000`, heartbeat `: ping` 30 dtk |

## Lisensi & kredit

- PrayTimes.js — perhitungan waktu sholat.
- Sumber jadwal resmi: bimasislam.kemenag.go.id (Kementerian Agama RI).
- jQuery, Moment.js — utilitas klien.
- Font: Inter, Sketsaramadhan.
