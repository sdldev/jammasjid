#!/usr/bin/env bash
# =============================================================================
# update.sh — Update Jam Masjid Santrimu tanpa instalasi ulang
#
# Pemakaian:
#   sudo bash scripts/update.sh
#   sudo bash scripts/update.sh --branch main
#   sudo bash scripts/update.sh --no-restart     # update kode saja
#   sudo bash scripts/update.sh --no-backup      # lewati backup (tidak disarankan)
#
# Robust terhadap:
#   - Working tree kotor. File yang ditulis aplikasi saat runtime
#     (db/, .env, public/img/logo-*) otomatis dibackup lalu dibersihkan.
#     Modifikasi file kode lain otomatis di-stash (bisa dipulihkan:
#     git stash list di APP_DIR).
#   - Bun di PATH user non-root (dicari juga di ~/.bun milik pemilik APP_DIR).
#   - Gagal di tengah jalan → rollback ke commit sebelumnya + pulihkan
#     file data dari backup + restart service.
#
# Aman: .env dan db/ tidak ditimpa oleh kode baru. Backup selalu dibuat
# kecuali --no-backup, dirotasi (10 terbaru disimpan).
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
RESTART=1
RESTART_DELAY=0          # detik sebelum restart (dipakai updater web: detached)
BACKUP=1
BACKUP_ROOT=""           # diisi setelah deteksi privilege

usage_args() {
  cat <<'USAGE'
Opsi:
  --branch NAMA       branch git (default main)
  --dir PATH          direktori aplikasi
  --no-restart        update kode saja
  --restart-delay N   tunggu N detik sebelum restart service (subshell detached)
  --no-backup         lewati backup
USAGE
}

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_B='\033[0;36m'; C_N='\033[0m'
log()  { printf "${C_B}[update]${C_N} %s\n" "$*"; }
ok()   { printf "${C_G}[ ok ]${C_N} %s\n" "$*" >&2; }
warn() { printf "${C_Y}[warn]${C_N} %s\n" "$*" >&2; }
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
    --restart-delay) RESTART_DELAY="${2:?--restart-delay butuh nilai}"; shift 2 ;;
    --backup)     BACKUP=1; warn "--backup kini default (backup selalu dibuat); opsi diabaikan."; shift ;;
    --no-backup)  BACKUP=0; shift ;;
    -h|--help)    usage; usage_args ;;
    *) die "Argumen tidak dikenal: $1 (pakai --help)" ;;
  esac
done

[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR bukan repo git. Jalankan install.sh dulu."

# Root diperlukan bila unit systemd harus dikelola; ketika dipanggil dari
# server lokal (updater web), kita berjalan sebagai user pemilik APP_DIR —
# boleh, selama dirinya menulis backup ke lokasi yang dia bisa dan systemd
# restart diberi jeda detached (masih memerlukan passwordless systemctl,
# jadi di luar sudo hanya bekerja bila systemd mengizinkan: server.local).
if [[ $EUID -ne 0 ]]; then
  warn "Tidak berjalan sebagai root — backup disimpan di lokasi user, systemd restart mungkin butuh sudo."
fi

cd "$APP_DIR"

# ---------- Bun ---------------------------------------------------------------
# Cari bun di lokasi umum milik root DAN pemilik APP_DIR (sudo bash -c tidak
# mewarisi PATH user desktop, jadi /home/<user>/.bun/bin harus discan eksplisit).
APP_OWNER="$(stat -c %U "$APP_DIR")"
APP_OWNER_HOME="$(getent passwd "$APP_OWNER" | cut -d: -f6)"
BUN_BIN=""
for cand in /root/.bun/bin/bun "$HOME/.bun/bin/bun" \
            ${APP_OWNER_HOME:+$APP_OWNER_HOME/.bun/bin/bun} \
            "$(command -v bun 2>/dev/null || true)"; do
  [[ -n "$cand" && -x "$cand" ]] && { BUN_BIN="$cand"; break; }
done
[[ -n "$BUN_BIN" ]] || die "Bun tidak ditemukan (dicari: /root, $HOME, home pemilik '$APP_OWNER'). Jalankan install.sh."
ok "Bun: $BUN_BIN"

# ---------- backup (selalu, dirotasi) ------------------------------------------
# Data operator adalah db/ + .env — jangan pernah update tanpa salinan.
# Lokasi: /var/backups (root) atau ~/.local/share/jam-masjid-backups (non-root).
if [[ $EUID -eq 0 ]]; then
  BACKUP_ROOT="/var/backups/jam-masjid"
else
  BACKUP_ROOT="$HOME/.local/share/jam-masjid-backups"
fi
BACKUP_DIR=""
STASHED=0
CLEANED_DATA=()

if [[ $BACKUP -eq 1 ]]; then
  ts="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="$BACKUP_ROOT/$ts"
  mkdir -p "$BACKUP_DIR"
  for f in db/database.json db/jadwal-sholat.json .env; do
    [[ -f "$f" ]] && cp -a "$f" "$BACKUP_DIR/"
  done
  git rev-parse HEAD > "$BACKUP_DIR/git-rev.txt" 2>/dev/null || true
  # Rotasi: simpan 10 run terbaru
  ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | tail -n +11 | xargs -r rm -rf --
  ok "Backup: $BACKUP_DIR"
else
  warn "Backup DILEWATI (--no-backup). db/ dan .env tidak tersalin — risiko operator tanggung sendiri."
fi

# ---------- tangani working tree kotor ----------------------------------------
# Dua kategori:
#   1) File data/runtime yang memang berubah saat aplikasi jalan
#      (db/*, .env, logo terupload): backup + bersihkan.
#      getDb shallow-merge dengan DEFAULT_DB sehingga isi db lama tetap
#      terbaca setelah update — file hanya perlu bersih agar pull lancar.
#   2) File kode yang diedit langsung di STB: git stash (dipulihkan manual
#      bila perlu: git stash list / git stash pop).
DATA_PATHS=('db/*' '.env' 'public/img/logo-*')
is_data_file() {
  local p="$1"
  for pat in "${DATA_PATHS[@]}"; do
    # shellcheck disable=SC2254
    case "$p" in
      $pat) return 0 ;;
    esac
  done
  return 1
}

DIRTY="$(git status --porcelain)"
if [[ -n "$DIRTY" ]]; then
  log "Working tree kotor — membersihkan sebelum update..."
  CODE_DIRTY=()
  while IFS= read -r line; do
    # format porcelain: XY <path>; path dengan spasi di-quote git ("a b")
    # XY '??' = untracked → bukan konflik pull; lewati (jangan dihapus/stash)
    #   — hanya db/ runtime yang dibersihkan dengan rm -f saat untracked.
    xy="${line:0:2}"
    p="${line:3}"
    [[ "$p" == \"*\" ]] && p="${p:1:${#p}-2}"
    [[ -z "$p" ]] && continue
    # Konflik merge (UU/AA/DD dsb): ambil versi repo saat ini, versi lokal
    # tersimpan di backup (data) atau stash (kode).
    if [[ "$xy" =~ ^(UU|AA|DD|DU|UD|AU|UA)$ ]]; then
      if is_data_file "$p"; then
        [[ -f "$p" && $BACKUP -eq 1 ]] && { mkdir -p "$BACKUP_DIR/$(dirname "$p")"; cp -a "$p" "$BACKUP_DIR/$p"; }
        git checkout HEAD -- "$p" 2>/dev/null || git checkout --theirs -- "$p" 2>/dev/null || rm -f "$p"
        git add "$p" 2>/dev/null || true
        git reset -q "$p" 2>/dev/null || true
        CLEANED_DATA+=("$p")
      else
        # Kode: simpan salinan konflik ke backup lalu ambil versi repo
        [[ -f "$p" && -n "$BACKUP_DIR" ]] && { mkdir -p "$BACKUP_DIR/$(dirname "$p")"; cp -a "$p" "$BACKUP_DIR/$p"; }
        git checkout HEAD -- "$p" 2>/dev/null || rm -f "$p"
        git add "$p" 2>/dev/null || true
        git reset -q "$p" 2>/dev/null || true
        warn "Konflik merge diselesaikan otomatis (versi repo): $p"
      fi
      continue
    fi
    if [[ "$xy" == "??" ]]; then
      if is_data_file "$p"; then
        [[ -f "$p" && $BACKUP -eq 1 ]] && { mkdir -p "$BACKUP_DIR/$(dirname "$p")"; cp -a "$p" "$BACKUP_DIR/$p"; }
        rm -f "$p"
        CLEANED_DATA+=("$p")
      fi
      continue
    fi
    if is_data_file "$p"; then
      if [[ $BACKUP -eq 1 && -f "$p" ]]; then
        mkdir -p "$BACKUP_DIR/$(dirname "$p")"
        cp -a "$p" "$BACKUP_DIR/$p"
      fi
      git checkout -- "$p" 2>/dev/null || rm -f "$p"   # untracked data file: hapus (sudah tersalin)
      CLEANED_DATA+=("$p")
    else
      CODE_DIRTY+=("$p")
    fi
  done <<< "$DIRTY"

  if [[ ${#CLEANED_DATA[@]} -gt 0 ]]; then
    ok "File data dibersihkan (tersalin ke backup): ${CLEANED_DATA[*]}"
  fi
  if [[ ${#CODE_DIRTY[@]} -gt 0 ]]; then
    # -c identitas inline: stash tidak butuh konfigurasi git global (root
    # di STB biasanya belum punya user.name/email).
    git -c user.name=update.sh -c user.email=update@local \
      stash push -m "update.sh $(date '+%Y-%m-%d %H:%M:%S'): ${CODE_DIRTY[*]}" \
      "${CODE_DIRTY[@]}"
    STASHED=1
    warn "Modifikasi kode lokal di-stash: ${CODE_DIRTY[*]}"
    warn "Pulihkan dengan: git stash pop   (lihat: git stash list)"
  fi
fi

# ---------- rolling update dengan rollback ------------------------------------
PREV_COMMIT="$(git rev-parse HEAD)"
log "Commit sekarang: $PREV_COMMIT"
log "Fetch branch $BRANCH..."
git fetch origin "$BRANCH" --prune
git checkout "$BRANCH"
NEW_COMMIT="$(git rev-parse "origin/$BRANCH")"

# Pulihkan file data dari backup ke working tree (setelah reset --hard
# melepas jejak mereka) — dipanggil baik di jalur sukses maupun rollback.
restore_data() {
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR/db" ]]; then
    cp -a "$BACKUP_DIR/db/." db/ 2>/dev/null || true
  fi
  if [[ -n "$BACKUP_DIR" && -f "$BACKUP_DIR/.env" ]]; then
    cp -a "$BACKUP_DIR/.env" .env
  fi
}

rollback() {
  warn "Update gagal — mengembalikan ke $PREV_COMMIT"
  git reset --hard "$PREV_COMMIT" || true
  "$BUN_BIN" install --frozen-lockfile --production || true
  restore_data
  # Restart terbaik usaha: root bisa langsung, non-root coba tanpa jaminan.
  if [[ $EUID -eq 0 ]]; then
    systemctl restart masjid-display.service || true
  else
    sudo -n systemctl restart masjid-display.service 2>/dev/null || true
  fi
  die "Rollback selesai. Layanan dikembalikan ke versi sebelumnya. Backup tetap ada: $BACKUP_DIR"
}

if [[ "$PREV_COMMIT" == "$NEW_COMMIT" ]]; then
  ok "Sudah versi terbaru ($NEW_COMMIT). Tidak ada perubahan kode."
  restore_data   # tree kotor yang dibersihkan tadi tetap dipulihkan
else
  log "Update $PREV_COMMIT → $NEW_COMMIT"
  trap rollback ERR
  git reset --hard "$NEW_COMMIT"
  "$BUN_BIN" install --frozen-lockfile --production
  trap 'die "Gagal pada baris $LINENO."' ERR
  restore_data
  ok "Kode & dependensi diperbarui."
fi

# ---------- pastikan file runtime ada ------------------------------------------
[[ -f .env ]] || warn ".env tidak ada! Jalankan install.sh atau buat manual (AUTH_SECRET wajib)."
[[ -f db/database.json ]] || warn "db/database.json tidak ada — aplikasi akan memakai DEFAULT_DB."

# ---------- sync unit systemd (kalau template berubah) -------------------------
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
# RESTART_DELAY > 0: dipakai updater web — subshell detached menunggu N detik
# supaya proses server sempat mengirim respons HTTP sebelum dimatikan.
do_restart() {
  systemctl restart masjid-display.service
  if systemctl is-active --quiet masjid-kiosk.service; then
    systemctl restart masjid-kiosk.service || true
  fi
}

if [[ $RESTART -eq 1 ]]; then
  if [[ "$RESTART_DELAY" -gt 0 ]]; then
    log "Restart dijadwalkan dalam ${RESTART_DELAY}s (detached)..."
    ( sleep "$RESTART_DELAY" && do_restart >/dev/null 2>&1 ) &
    disown || true
  elif [[ $EUID -eq 0 ]]; then
    log "Restart masjid-display..."
    do_restart
  else
    warn "Bukan root — mencoba restart via sudo tanpa password..."
    sudo -n bash -c "$(declare -f do_restart); do_restart" 2>/dev/null \
      || warn "Restart gagal. Jalankan manual: sudo systemctl restart masjid-display"
  fi
  # verifikasi
  if [[ $EUID -eq 0 ]]; then
    for i in $(seq 1 30); do
      if curl -sf "http://localhost:11111/" >/dev/null 2>&1 \
         && systemctl is-active --quiet masjid-display.service; then
        ok "Server merespons."
        break
      fi
      [[ $i -eq 30 ]] && { journalctl -u masjid-display.service -n 30 --no-pager; die "Server tidak merespons setelah restart."; }
      sleep 1
    done
  fi
else
  warn "Restart dilewati (--no-restart)."
fi

cat <<EOF

$(printf "${C_G}Update selesai.${C_N}")
  Versi   : $PREV_COMMIT → $NEW_COMMIT
  Backup  : $BACKUP_DIR
  Stash   : $([[ $STASHED -eq 1 ]] && echo 'ada (git stash list)' || echo '-')
  Cek     : systemctl status masjid-display
            journalctl -u masjid-display -f
EOF
