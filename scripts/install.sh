#!/usr/bin/env bash
# =============================================================================
# install.sh — Instalasi Jam Masjid Santrimu untuk Armbian Desktop
#
# Repo : https://github.com/sdldev/jammasjid
# Target: Armbian (Debian/Ubuntu based) desktop, kiosk TV/monitor masjid
#
# Pemakaian:
#   sudo bash install.sh
#   sudo bash install.sh --user orang --dir /opt/jam-masjid
#   sudo bash install.sh --skip-cleanup        # lewati pembersihan apt
#   sudo bash install.sh --branch main
#
# Yang dilakukan:
#   1. Cek root, OS, arsitektur, koneksi internet
#   2. apt update + upgrade + pembersihan konservatif
#   3. Install dependensi (curl, git, ca-certificates, chromium, utilitas X)
#   4. Install Bun (kalau belum ada; user root)
#   5. Clone/pull repo ke /opt/jam-masjid
#   6. bun install --frozen-lockfile --production
#   7. Buat .env (AUTH_SECRET acak, ADMIN_PASS default admin1234)
#   8. Pasang systemd: masjid-display + masjid-kiosk (user desktop)
#   9. Aktifkan service, verifikasi HTTP
#
# Idempoten: aman dijalankan ulang (tidak menimpa .env yang sudah ada).
# =============================================================================
set -Eeuo pipefail

# ---------- konfigurasi default (bisa di-override via argumen) ---------------
REPO_URL="${REPO_URL:-https://github.com/sdldev/jammasjid.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/jam-masjid}"
APP_USER="${APP_USER:-}"          # user yang menjalankan kiosk (desktop login)
KIOSK_DISPLAY="${KIOSK_DISPLAY:-:0}"
SKIP_CLEANUP=0
SKIP_UPGRADE=0
SKIP_TAILSCALE=0
SKIP_CLOUDFLARED=0
TAILSCALE_OWNER="${TAILSCALE_OWNER:-satrimuhub@gmail.com}"
PORT="${PORT:-11111}"

# ---------- utilitas ---------------------------------------------------------
C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_B='\033[0;36m'; C_N='\033[0m'
log()  { printf "${C_B}[install]${C_N} %s\n" "$*"; }
ok()   { printf "${C_G}[ ok ]${C_N} %s\n" "$*"; }
warn() { printf "${C_Y}[warn]${C_N} %s\n" "$*"; }
die()  { printf "${C_R}[fail]${C_N} %s\n" "$*" >&2; exit 1; }

trap 'die "Gagal pada baris $LINENO. Instalasi dihentikan."' ERR

usage() {
  # Cetak blok komentar header (baris 2 s/d baris sebelum 'set -Eeuo pipefail')
  awk 'NR>1 && /^# =+$/ && NR>3 {exit} NR>1 {sub(/^# ?/,""); print}' "$0" | sed -n '1,40p'
  exit 0
}

# ---------- parse argumen ----------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)        APP_USER="${2:?--user butuh nilai}"; shift 2 ;;
    --dir)         APP_DIR="${2:?--dir butuh nilai}"; shift 2 ;;
    --branch)      BRANCH="${2:?--branch butuh nilai}"; shift 2 ;;
    --repo)        REPO_URL="${2:?--repo butuh nilai}"; shift 2 ;;
    --display)     KIOSK_DISPLAY="${2:?--display butuh nilai}"; shift 2 ;;
    --port)        PORT="${2:?--port butuh nilai}"; shift 2 ;;
    --tailscale-email) TAILSCALE_OWNER="${2:?--tailscale-email butuh nilai}"; shift 2 ;;
    --skip-tailscale) SKIP_TAILSCALE=1; shift ;;
    --skip-cloudflared) SKIP_CLOUDFLARED=1; shift ;;
    --skip-cleanup) SKIP_CLEANUP=1; shift ;;
    --skip-upgrade) SKIP_UPGRADE=1; shift ;;
    -h|--help)     usage ;;
    *) die "Argumen tidak dikenal: $1 (pakai --help)" ;;
  esac
done

# ---------- 1. pra-cek -------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Jalankan sebagai root: sudo bash install.sh"
[[ -f /etc/debian_version ]] || die "Skrip ini untuk Debian/Ubuntu (Armbian). OS lain belum didukung."
arch="$(uname -m)"
case "$arch" in
  aarch64|arm64|x86_64|amd64) ok "Arsitektur: $arch" ;;
  *) die "Arsitektur $arch belum didukung." ;;
esac
command -v apt-get >/dev/null || die "apt-get tidak ditemukan."

if ! getent hosts github.com >/dev/null 2>&1; then
  die "Tidak ada koneksi internet (DNS github.com gagal). Sambungkan jaringan lalu ulangi."
fi
ok "Koneksi internet tersedia."

# Tentukan user kiosk: argumen > user pemilik sesi desktop > SUDO_USER > root
if [[ -z "$APP_USER" ]]; then
  APP_USER="$(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $3}' | grep -v '^root$' | head -1 || true)"
fi
if [[ -z "$APP_USER" ]]; then APP_USER="${SUDO_USER:-root}"; fi
id "$APP_USER" >/dev/null 2>&1 || die "User '$APP_USER' tidak ada."
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
ok "User kiosk: $APP_USER (home: $APP_HOME)"

# ---------- 2. apt update/upgrade + pembersihan konservatif ------------------
export DEBIAN_FRONTEND=noninteractive
log "apt update..."
apt-get update -qq

if [[ $SKIP_UPGRADE -eq 0 ]]; then
  log "apt upgrade (bisa beberapa menit)..."
  apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
  ok "Sistem diperbarui."
else
  warn "Upgrade sistem dilewati (--skip-upgrade)."
fi

if [[ $SKIP_CLEANUP -eq 0 ]]; then
  log "Membersihkan paket tidak terpakai (konservatif)..."
  apt-get -y autoremove --purge
  apt-get -y clean
  apt-get -y autoclean

  # Paket desktop berat yang tidak dibutuhkan display. Hanya dihapus bila ada.
  PAKET_BERAT=(
    libreoffice-core libreoffice-common libreoffice-writer libreoffice-calc
    libreoffice-impress thunderbird hexchat transmission-gtk
    gnome-mines gnome-sudoku gnome-mahjongg aisleriot
    # Engine browser kedua + pembaca PDF — kiosk hanya pakai Chromium
    libwebkit2gtk-4.0-37 libjavascriptcoregtk-4.0-18 libjs-mathjax atril
    # Toolchain kompilasi — tidak dipakai di runtime
    gcc gcc-7 g++ g++-7 cpp-7 libc6-dev libstdc++-7-dev binutils-aarch64-linux-gnu
    # Vim besar — vi.tiny tetap ada untuk edit darurat
    vim-runtime
    # Ikon tema & data aplikasi desktop yang tidak dipakai
    humanity-icon-theme gnome-icon-theme
    # VPN & share Windows tidak dipakai
    openvpn
    # Pemutar media mpv menarik libavdevice57→libavfilter6→libflite1 (~60 MB)
    mpv libavdevice57
  )
  # CATATAN (jangan masukkan ke daftar di atas):
  #  - libgl1-mesa-dri / xserver-xorg*  → menarik X server & gvfs; dibutuhkan
  #    kiosk dan automount USB (instalasi/boot awal STB dari USB/microSD).
  #  - gvfs / udisks2 / samba-libs     → dibutuhkan untuk baca-tulis USB.
  #  - iso-codes / poppler-data        → dependensi paket lain; biarkan.
  terpasang=()
  for p in "${PAKET_BERAT[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 && terpasang+=("$p")
  done
  if [[ ${#terpasang[@]} -gt 0 ]]; then
    log "Menghapus paket berat: ${terpasang[*]}"
    apt-get -y purge "${terpasang[@]}" || warn "Sebagian paket gagal dihapus (lanjut)."
    apt-get -y autoremove --purge
  else
    ok "Tidak ada paket berat yang terpasang."
  fi
  ok "Pembersihan selesai."
else
  warn "Pembersihan apt dilewati (--skip-cleanup)."
fi

# ---------- 2b. Matikan service & applet yang tidak dipakai display ---------
# Aman diulang (idempoten). WiFi (NetworkManager/wpa_supplicant) TIDAK disentuh.
SERVIS_MATI=(apache2 cups cups-browsed bluetooth avahi-daemon unattended-upgrades
  ubuntu-advantage ua-reboot-cmds sysstat rsync)
# Dibiarkan aktif dengan sengaja:
#  - udisks2        → automount USB (STB kadang boot/update lewat USB/microSD)
#  - getty@tty1     → terminal fisik darurat untuk recovery
#  - fake-hwclock/ntp/timesyncd → STB tanpa RTC butuh sinkronisasi jam
for s in "${SERVIS_MATI[@]}"; do
  if systemctl list-unit-files "$s.service" >/dev/null 2>&1; then
    systemctl disable --now "$s.service" >/dev/null 2>&1 \
      && log "Service dimatikan: $s" \
      || warn "Gagal mematikan $s (lanjut)."
  fi
done

# Applet desktop (bluetooth/audio/printer tray) tidak dibutuhkan kiosk dan
# memakan ±250 MB RAM. Dihapus dari autostart XDG (rename → .disabled, bukan
# dihapus, agar mudah dikembalikan). nm-applet ikut dimatikan dari autostart —
# WiFi tetap jalan lewat NetworkManager; bila perlu atur WiFi dari GUI,
# jalankan `nm-applet &` manual.
APPLET_MATI=(blueman pasystray print-applet applet nm-applet polkit-gnome)
dihapus=0
for d in /etc/xdg/autostart "$APP_HOME/.config/autostart"; do
  [[ -d "$d" ]] || continue
  for f in "$d"/*.desktop; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f" .desktop)"
    for a in "${APPLET_MATI[@]}"; do
      if [[ "$base" == *"$a"* ]]; then
        mv "$f" "$f.disabled" 2>/dev/null && dihapus=$((dihapus+1))
        break
      fi
    done
  done
done
# Matikan juga instance yang sedang berjalan di sesi desktop sekarang
pkill -u "$APP_USER" -f 'blueman-applet|pasystray|nm-applet|applet.py|polkit-gnome-authentication-agent' 2>/dev/null || true
ok "Applet desktop dinonaktifkan ($dihapus entri autostart). WiFi tetap berfungsi (NetworkManager aktif)."

# ---------- 3. dependensi ----------------------------------------------------
log "Memasang dependensi sistem..."
APT_PKGS=(curl ca-certificates git unzip jq rsync x11-utils)
# Chromium: nama paket berbeda antara Debian (chromium) dan Ubuntu/Armbian (snap)
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  if apt-cache policy chromium 2>/dev/null | grep -q 'Candidate: [0-9]'; then
    APT_PKGS+=(chromium)
  elif command -v snap >/dev/null; then
    log "Chromium tidak ada di apt; memasang via snap..."
    snap install chromium || warn "Instalasi snap chromium gagal."
  else
    warn "Chromium tidak ditemukan di apt maupun snap. Pasang manual setelah instalasi."
  fi
fi
apt-get -y install "${APT_PKGS[@]}"
ok "Dependensi sistem terpasang."

# ---------- 4. Bun -----------------------------------------------------------
BUN_BIN=""
for cand in /root/.bun/bin/bun "$APP_HOME/.bun/bin/bun" "$(command -v bun 2>/dev/null || true)"; do
  [[ -n "$cand" && -x "$cand" ]] && { BUN_BIN="$cand"; break; }
done
if [[ -z "$BUN_BIN" ]]; then
  log "Memasang Bun (root)..."
  curl -fsSL https://bun.sh/install | bash
  BUN_BIN="/root/.bun/bin/bun"
fi
[[ -x "$BUN_BIN" ]] || die "Bun gagal dipasang."
ok "Bun: $BUN_BIN ($("$BUN_BIN" --version))"

# ---------- 5. clone / update repo ------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Repo sudah ada → update ke branch $BRANCH..."
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only
  ok "Repo diperbarui."
else
  log "Clone $REPO_URL → $APP_DIR (branch $BRANCH)..."
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
  ok "Repo di-clone."
fi
cd "$APP_DIR"

# ---------- 6. dependensi aplikasi ------------------------------------------
log "bun install (production, lockfile terkunci)..."
# Dev deps (vitest, wrangler) tidak dibutuhkan di runtime display
"$BUN_BIN" install --frozen-lockfile --production
ok "Dependensi aplikasi terpasang."

# ---------- 7. .env ----------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  ok ".env sudah ada — tidak ditimpa."
else
  log "Membuat .env baru..."
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  cat > "$ENV_FILE" <<EOF
# Dibuat otomatis oleh install.sh — JANGAN di-commit.
AUTH_SECRET=$SECRET
# Password admin awal. Login DITOLAK selama masih admin1234:
# setelah instalasi buka admin → "Ganti password", atau ubah nilai ini + restart.
ADMIN_PASS=admin1234
PORT=$PORT
EOF
  chmod 600 "$ENV_FILE"
  ok ".env dibuat (AUTH_SECRET acak)."
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" 2>/dev/null || true

# ---------- 8. systemd unit --------------------------------------------------
log "Memasang systemd unit..."

cat > /etc/systemd/system/masjid-display.service <<EOF
[Unit]
Description=Jam Masjid Santrimu - server lokal Bun
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$BUN_BIN src/server.mjs
Restart=on-failure
RestartSec=5
User=$APP_USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Path chromium terdeteksi
CHROME_BIN="$(command -v chromium || command -v chromium-browser || echo /usr/bin/chromium)"

# ---------- 8b. sesi X minimal (xinit + openbox), bukan lightdm/XFCE --------
# Display manager penuh (lightdm+XFCE) menghabiskan ±150 MB RAM untuk tugas
# yang sebenarnya cukup dilayani X + window manager ringan. Skema:
#   masjid-x.service (root) → xinit → X :0 + openbox (user kiosk)
#   masjid-kiosk.service    → Chromium menempel ke DISPLAY :0
# ROLLBACK ke XFCE/lightdm:
#   sudo systemctl disable masjid-x masjid-kiosk
#   sudo systemctl enable lightdm
#   sudo systemctl set-default graphical.target && sudo reboot
log "Memasang sesi X minimal (openbox)..."
if ! command -v openbox >/dev/null 2>&1; then
  apt-get -y install openbox || warn "openbox gagal dipasang (lanjut; kiosk tetap bisa tanpa WM)."
fi
# unclutter menyembunyikan kursor mouse (mengganggu tampilan jam);
# xdotool untuk memarkir kursor di pojok saat start
apt-get -y install unclutter xdotool || warn "unclutter/xdotool gagal dipasang (kursor tetap terlihat)."
mkdir -p /etc/jam-masjid
cat > /etc/jam-masjid/xinitrc <<EOF
#!/bin/sh
# Sesi kiosk minimal: X (root) + openbox sebagai user kiosk.
# Kursor: diparkir di pojok kanan bawah lalu disembunyikan unclutter
# setelah 0,5 dtk diam — tidak mengganggu tampilan jam.
su - $APP_USER -c 'DISPLAY=$KIOSK_DISPLAY sh -c "
  xdotool mousemove 1919 1079 2>/dev/null
  unclutter -idle 0.5 -root &
  openbox
"' &
exec sh -c 'while true; do sleep 3600; done'
EOF
chmod 755 /etc/jam-masjid/xinitrc

# Paksa konektor HDMI menyala + mode 1080p setiap boot.
# STB Amlogic S905 (kernel 5.1-aml) kadang menandai HDMI-1 "disconnected"
# walau TV menyala — meson-drm fallback ke 1024x768 (layar tidak fullscreen).
cat > /etc/jam-masjid/fix-resolution.sh <<'EOS'
#!/bin/sh
# Paksa konektor HDMI menyala + mode 1080p untuk kiosk Jam Masjid.
# STB Amlogic S905 (kernel 5.1-aml) kadang menandai HDMI-1 "disconnected"
# walau TV menyala → meson-drm fallback ke 1024x768 (layar tidak fullscreen).
CONNECTOR=/sys/class/drm/card0-HDMI-A-1
for i in $(seq 1 20); do
  [ -e "$CONNECTOR/status" ] && break
  sleep 1
done
echo on > "$CONNECTOR/status" 2>/dev/null
# Mode standar CVT untuk 1920x1080@60
if command -v xrandr >/dev/null; then
  DISPLAY=${KIOSK_DISPLAY:-:0} xrandr --newmode 1920x1080_60.00 173.00 1920 2048 2248 2576 1080 1083 1088 1120 -hsync +vsync 2>/dev/null
  DISPLAY=${KIOSK_DISPLAY:-:0} xrandr --addmode HDMI-1 1920x1080_60.00 2>/dev/null
  DISPLAY=${KIOSK_DISPLAY:-:0} xrandr --output HDMI-1 --mode 1920x1080_60.00 2>/dev/null
fi
# Resize jendela kiosk ke ukuran layar penuh (window manager X minimal
# kadang membiarkan Chromium tetap kecil walau mode layar sudah benar).
if command -v xdotool >/dev/null; then
  for i in $(seq 1 10); do
    WIN=$(DISPLAY=${KIOSK_DISPLAY:-:0} xdotool search --name "Jam Masjid" 2>/dev/null | head -1)
    [ -n "$WIN" ] && DISPLAY=${KIOSK_DISPLAY:-:0} xdotool windowsize "$WIN" 1920 1080 2>/dev/null && break
    sleep 2
  done
fi
EOS
chmod 755 /etc/jam-masjid/fix-resolution.sh

cat > /etc/systemd/system/masjid-x.service <<EOF
[Unit]
Description=Jam Masjid Santrimu - sesi X minimal (xinit + openbox)
Conflicts=lightdm.service gdm.service sddm.service
After=systemd-user-sessions.service

[Service]
Type=simple
User=root
ExecStart=/usr/bin/xinit /etc/jam-masjid/xinitrc -- $KIOSK_DISPLAY vt1 -nolisten tcp
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Unit resolusi terpisah (bukan ExecStartPost masjid-x): mengatur display X
# dari ExecStartPost membuat xinit keluar — pakai oneshot yang berjalan
# setelah masjid-x naik.
cat > /etc/systemd/system/masjid-resolution.service <<EOF
[Unit]
Description=Jam Masjid Santrimu - paksa resolusi HDMI 1080p
After=masjid-x.service
Requires=masjid-x.service

[Service]
Type=oneshot
User=root
Environment=KIOSK_DISPLAY=$KIOSK_DISPLAY
ExecStart=/etc/jam-masjid/fix-resolution.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl enable masjid-resolution.service

# Non-root X di beberapa Armbian ditolak membuka VT; izinkan lewat Xwrapper.
# (X tetap dijalankan root oleh unit di atas, tapi ini menjaga skenario manual.)
printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config

# Boot langsung ke sesi X minimal, bukan display manager
systemctl set-default multi-user.target
systemctl disable lightdm.service 2>/dev/null || true
systemctl enable masjid-x.service

# Purge XFCE + lightdm: sesi X minimal di atas sudah menggantikannya.
# Catatan: setelah purge, rollback ke XFCE memerlukan instal ulang paket
#   (apt-get install xfce4 lightdm && systemctl enable lightdm &&
#    systemctl set-default graphical.target && reboot)
# Lewati purge dengan: SKIP_XFCE_PURGE=1 bash scripts/install.sh
if [[ "${SKIP_XFCE_PURGE:-0}" != "1" ]]; then
  xfce_terpasang=()
  for p in $(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -E '^(xfce4|xfwm4|xfdesktop4|thunar|lightdm|mousepad|ristretto|parole|xfce4-.*|lightdm-.*)' || true); do
    xfce_terpasang+=("$p")
  done
  if [[ ${#xfce_terpasang[@]} -gt 0 ]]; then
    log "Purge XFCE/lightdm (${#xfce_terpasang[@]} paket, ±150 MB)..."
    apt-get -y purge "${xfce_terpasang[@]}" || warn "Sebagian paket XFCE gagal dihapus (lanjut)."
    apt-get -y autoremove --purge || true
    ok "XFCE/lightdm dihapus. Sesi grafis sepenuhnya milik masjid-x."
  else
    ok "XFCE/lightdm tidak terpasang."
  fi
fi

# getty di tty1 BEREBUT VT dengan X (X dipasang di vt1) → layar kadang
# menampilkan prompt login alih-alih jam. Matikan & mask; tty2 tetap
# disiapkan untuk recovery darurat (Ctrl+Alt+F2).
systemctl disable --now getty@tty1.service 2>/dev/null || true
systemctl mask getty@tty1.service
systemctl unmask getty@tty2.service 2>/dev/null || true
systemctl enable getty@tty2.service 2>/dev/null || true

# Pastikan X menang saat boot walau getty tty1 sempat terjadwal
mkdir -p /etc/systemd/system/masjid-x.service.d
cat > /etc/systemd/system/masjid-x.service.d/10-tty1.conf <<'EOT'
[Unit]
After=getty@tty1.service
Conflicts=getty@tty1.service
EOT

# Chromium harus menunggu X :0 benar-benar siap (bukan sekadar unit start)
mkdir -p /etc/systemd/system/masjid-kiosk.service.d
cat > /etc/systemd/system/masjid-kiosk.service.d/10-wait-x.conf <<'EOT'
[Unit]
After=masjid-x.service
Requires=masjid-x.service

[Service]
ExecStartPre=/bin/sh -c 'for i in $(seq 1 30); do DISPLAY=:0 xdpyinfo >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
EOT
ok "Sesi X minimal terpasang (lightdm & getty tty1 nonaktif; rollback lihat komentar di install.sh)."

cat > /etc/systemd/system/masjid-kiosk.service <<EOF
[Unit]
Description=Jam Masjid Santrimu - Chromium kiosk
After=masjid-display.service masjid-x.service
Wants=masjid-display.service

[Service]
Type=simple
User=$APP_USER
Environment=DISPLAY=$KIOSK_DISPLAY
Environment=XAUTHORITY=$APP_HOME/.Xauthority
# Bersihkan singleton lock usang — sisa Chromium yang mati mendadak / profile
# yang dipindah dari mesin lain membuat dialog "profile appears to be used by
# another Chromium process (<host-pid>)" muncul setiap start kiosk.
ExecStartPre=/bin/rm -f $APP_HOME/.config/jammasjid-kiosk/SingletonLock $APP_HOME/.config/jammasjid-kiosk/SingletonCookie $APP_HOME/.config/jammasjid-kiosk/SingletonSocket
ExecStartPre=/bin/sh -c 'for i in \$(seq 1 40); do curl -sf http://localhost:$PORT/ >/dev/null && exit 0; sleep 1; done; exit 1'
ExecStart=$CHROME_BIN \\
  --kiosk \\
  --force-device-scale-factor=1 \\
  --start-fullscreen \\
  --window-position=0,0 \\
  --log-level=3 \\
  --disable-gpu \\
  --disable-pinch \\
  --autoplay-policy=no-user-gesture-required \\
  --disable-features=Translate,TranslateUI \\
  --lang=id-ID \\
  --accept-lang=id-ID,id \\
  --disable-component-update \\
  --disable-notifications \\
  --no-first-run \\
  --no-default-browser-check \\
  --user-data-dir=$APP_HOME/.config/jammasjid-kiosk \\
  http://localhost:$PORT/
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable masjid-display.service
systemctl enable masjid-kiosk.service
ok "Service terpasang & diaktifkan."

# ---------- 9. jalankan & verifikasi ----------------------------------------
log "Menjalankan server..."
systemctl restart masjid-display.service

HTTP_OK=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then HTTP_OK=1; break; fi
  sleep 1
done
[[ $HTTP_OK -eq 1 ]] || {
  journalctl -u masjid-display.service -n 30 --no-pager || true
  die "Server tidak merespons di port $PORT. Lihat log di atas."
}
ok "Server merespons di http://localhost:$PORT/"

# Kiosk hanya bisa jalan bila sesi grafis aktif
if [[ -n "${DISPLAY:-}" ]] || pgrep -x Xorg >/dev/null 2>&1 || pgrep -x Xwayland >/dev/null 2>&1; then
  systemctl restart masjid-kiosk.service || warn "Kiosk gagal start; periksa: journalctl -u masjid-kiosk -f"
else
  warn "Sesi grafis belum aktif. Kiosk akan jalan otomatis saat login desktop."
fi

# ---------- 10. Tailscale (remote SSH + admin) ------------------------------
TS_IP=""
if [[ $SKIP_TAILSCALE -eq 1 ]]; then
  warn "Tailscale dilewati (--skip-tailscale)."
else
  log "Memasang Tailscale (remote SSH untuk developer, admin web untuk pengurus)..."
  if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  systemctl enable --now tailscaled
  # --advertise-tags memerlukan tagOwners sudah berisi email pemilik;
  # ACL awal diterapkan manual / dari panel admin setelah login.
  if ! tailscale status >/dev/null 2>&1; then
    log "Login Tailscale — buka URL berikut di browser ($TAILSCALE_OWNER):"
    tailscale up --ssh || warn "tailscale up belum selesai — ulangi: sudo tailscale up --ssh"
  else
    tailscale up --ssh >/dev/null 2>&1 || true
  fi
  TS_IP="$(tailscale ip -4 2>/dev/null || true)"

  # Catat pemilik tailnet ke .env (dipakai tailscaleSync.mjs saat membangun ACL)
  if ! grep -q '^TAILSCALE_OWNER=' "$ENV_FILE"; then
    printf 'TAILSCALE_OWNER=%s\n' "$TAILSCALE_OWNER" >> "$ENV_FILE"
  fi
  if [[ -n "$TS_IP" ]]; then
    ok "Tailscale aktif: $TS_IP"
  else
    warn "Tailscale terpasang tapi belum login. Jalankan: sudo tailscale up --ssh"
  fi
fi

# ---------- 10b. cloudflared (Quick Tunnel dari panel admin) ----------------
if [[ $SKIP_CLOUDFLARED -eq 1 ]]; then
  warn "cloudflared dilewati (--skip-cloudflared)."
elif command -v cloudflared >/dev/null 2>&1; then
  ok "cloudflared sudah terpasang: $(cloudflared --version 2>/dev/null | head -n1)"
else
  log "Memasang cloudflared (Quick Tunnel publik sementara dari admin panel)..."
  CF_DEB_ARCH=""
  case "$arch" in
    aarch64|arm64) CF_DEB_ARCH="arm64" ;;
    x86_64|amd64)  CF_DEB_ARCH="amd64" ;;
  esac
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_DEB_ARCH}"
  if curl -fsSL -o /usr/local/bin/cloudflared "$CF_URL"; then
    chmod +x /usr/local/bin/cloudflared
    ok "cloudflared terpasang: $(/usr/local/bin/cloudflared --version 2>/dev/null | head -n1)"
  else
    warn "Gagal mengunduh cloudflared — Quick Tunnel nonaktif sampai dipasang manual."
  fi
fi

# ---------- ringkasan --------------------------------------------------------
cat <<EOF

$(printf "${C_G}Instalasi selesai.${C_N}")

  Display : http://localhost:$PORT/
  Admin   : http://localhost:$PORT/admin/
  Login   : user "admin", password dari ADMIN_PASS di $ENV_FILE
  Direktori: $APP_DIR
  User     : $APP_USER

Langkah wajib berikutnya:
  1. Buka admin → "Ganti password" (password default admin1234 DITOLAK).
  2. Cek layar display sudah tampil (kiosk). Kalau belum:
       sudo systemctl start masjid-kiosk
       journalctl -u masjid-kiosk -f
  3. Cek status server:
       systemctl status masjid-display
       journalctl -u masjid-display -f

Perintah berguna:
  sudo bash $APP_DIR/scripts/update.sh          # update kode & restart
  sudo systemctl restart masjid-display         # restart server
  sudo systemctl restart masjid-kiosk           # restart browser kiosk
EOF

if [[ -n "$TS_IP" ]]; then
  cat <<EOF

Remote via Tailscale (pemilik tailnet: $TAILSCALE_OWNER):
  STB IP    : $TS_IP
  SSH       : ssh $APP_USER@$TS_IP        (hanya tag:dev)
  Admin web : http://$TS_IP:$PORT/admin/  (tag:dev + tag:pengurus)

  Wajib sekali di Admin Console (https://login.tailscale.com/admin/machines):
    1. Disable key expiry untuk STB ini.
    2. Set ACL — bisa lewat panel admin (menu Remote/Tailscale) atau
       tempel db/tailscale-acl.json ke https://login.tailscale.com/admin/acls
  Email pengurus (boleh lebih dari 1) diatur dari panel admin → Remote.
EOF
fi
