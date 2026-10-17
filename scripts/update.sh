#!/usr/bin/env bash
# =============================================================================
# update.sh — Update Jam Masjid Santrimu tanpa instalasi ulang
#
# Pemakaian:
#   sudo bash scripts/update.sh
#   sudo bash scripts/update.sh --branch main
#   sudo bash scripts/update.sh --no-restart     # update kode saja
#   sudo bash scripts/update.sh --backup         # backup db sebelum update
#
# Aman: .env dan db/ tidak ditimpa. Kalau pull gagal, repo dikembalikan ke
# commit sebelumnya (rollback otomatis).
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
RESTART=1
BACKUP=0

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_B='\033[0;36m'; C_N='\033[0m'
log()  { printf "${C_B}[update]${C_N} %s\n" "$*"; }
ok()   { printf "${C_G}[ ok ]${C_N} %s\n" "$*"; }
warn() { printf "${C_Y}[warn]${C_N} %s\n" "$*"; }
die()  { printf "${C_R}[fail]${C_N} %s\n" "$*" >&2; exit 1; }

trap 'die "Gagal pada baris $LINENO."' ERR

usage() {
  awk 'NR>1 && /^# =+$/ && NR>3 {exit} NR>1 {sub(/^# ?/,""); print}' "$0" | sed -n '1,40p'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)     BRANCH="${2:?--branch butuh nilai}"; shift 2 ;;
    --dir)        APP_DIR="${2:?--dir butuh nilai}"; shift 2 ;;
    --no-restart) RESTART=0; shift ;;
    --backup)     BACKUP=1; shift ;;
    -h|--help)    usage ;;
    *) die "Argumen tidak dikenal: $1 (pakai --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Jalankan sebagai root: sudo bash scripts/update.sh"
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR bukan repo git. Jalankan install.sh dulu."

cd "$APP_DIR"

# ---------- Bun ---------------------------------------------------------------
BUN_BIN=""
for cand in /root/.bun/bin/bun "$(command -v bun 2>/dev/null || true)"; do
  [[ -n "$cand" && -x "$cand" ]] && { BUN_BIN="$cand"; break; }
done
[[ -n "$BUN_BIN" ]] || die "Bun tidak ditemukan. Jalankan install.sh untuk memasangnya."

# ---------- backup opsional ---------------------------------------------------
if [[ $BACKUP -eq 1 ]]; then
  ts="$(date +%Y%m%d-%H%M%S)"
  bak="/var/backups/jam-masjid-$ts"
  mkdir -p "$bak"
  [[ -f db/database.json ]]   && cp -a db/database.json "$bak/"
  [[ -f db/jadwal-sholat.json ]] && cp -a db/jadwal-sholat.json "$bak/"
  [[ -f .env ]]               && cp -a .env "$bak/"
  ok "Backup: $bak"
fi

# ---------- rolling update dengan rollback ------------------------------------
PREV_COMMIT="$(git rev-parse HEAD)"
log "Commit sekarang: $PREV_COMMIT"
log "Fetch branch $BRANCH..."
git fetch origin "$BRANCH" --prune
git checkout "$BRANCH"
NEW_COMMIT="$(git rev-parse "origin/$BRANCH")"

if [[ "$PREV_COMMIT" == "$NEW_COMMIT" ]]; then
  ok "Sudah versi terbaru ($NEW_COMMIT). Tidak ada perubahan."
else
  log "Update $PREV_COMMIT → $NEW_COMMIT"
  rollback() {
    warn "Update gagal — mengembalikan ke $PREV_COMMIT"
    git reset --hard "$PREV_COMMIT" || true
    "$BUN_BIN" install --frozen-lockfile --production || true
    systemctl restart masjid-display.service || true
    die "Rollback selesai. Layanan dikembalikan ke versi sebelumnya."
  }
  trap rollback ERR
  git reset --hard "$NEW_COMMIT"
  "$BUN_BIN" install --frozen-lockfile --production
  trap 'die "Gagal pada baris $LINENO."' ERR
  ok "Kode & dependensi diperbarui."
fi

# ---------- pastikan file runtime ada ----------------------------------------
[[ -f .env ]] || warn ".env tidak ada! Jalankan install.sh atau buat manual (AUTH_SECRET wajib)."
[[ -f db/database.json ]] || warn "db/database.json tidak ada — aplikasi akan memakai DEFAULT_DB."

# ---------- sync unit systemd (kalau template berubah) -----------------------
for unit in masjid-display masjid-kiosk; do
  src="deploy/$unit.service"
  dst="/etc/systemd/system/$unit.service"
  if [[ -f "$src" && -f "$dst" ]]; then
    # Hanya salin bila template repo berbeda dari yang terpasang
    # (abaikan baris yang diisi install.sh: WorkingDirectory/ExecStart/User)
    if ! diff -q <(grep -vE '^(WorkingDirectory|ExecStart|User|Environment)=|^ExecStartPre=' "$src") \
                 <(grep -vE '^(WorkingDirectory|ExecStart|User|Environment)=|^ExecStartPre=' "$dst") >/dev/null; then
      warn "Template $unit.service berubah. Unit terpasang TIDAK ditimpa otomatis."
      warn "Bandingkan manual: diff $src $dst lalu sesuaikan path/user."
    fi
  fi
done

# ---------- restart -----------------------------------------------------------
if [[ $RESTART -eq 1 ]]; then
  log "Restart masjid-display..."
  systemctl restart masjid-display.service
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:11111/" >/dev/null 2>&1; then
      ok "Server merespons."
      break
    fi
    [[ $i -eq 30 ]] && { journalctl -u masjid-display.service -n 30 --no-pager; die "Server tidak merespons setelah restart."; }
    sleep 1
  done
  if systemctl is-active --quiet masjid-kiosk.service; then
    log "Restart kiosk agar memuat ulang halaman..."
    systemctl restart masjid-kiosk.service || warn "Kiosk gagal restart."
  fi
else
  warn "Restart dilewati (--no-restart). Jalankan: systemctl restart masjid-display"
fi

cat <<EOF

$(printf "${C_G}Update selesai.${C_N}")
  Versi : $NEW_COMMIT
  Cek   : systemctl status masjid-display
          journalctl -u masjid-display -f
EOF
