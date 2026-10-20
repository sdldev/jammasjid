#!/usr/bin/env bash
# ============================================================================
# tailscale-setup.sh — Pasang & konfigurasi Tailscale di STB Jam Masjid
#
# Jalankan sebagai root di STB Armbian:
#   sudo bash scripts/tailscale-setup.sh
#
# Setelah selesai:
#   1. Catat IP Tailscale (100.x.x.x) yang ditampilkan
#   2. Buka https://login.tailscale.com/admin/machines
#      - beri tag:server pada STB ini
#      - klik "..." → "Disable key expiry" (STB tidak ada yang jaga re-auth)
#   3. Terapkan ACL di https://login.tailscale.com/admin/acls
#      (lihat contoh di bawah / docs/tailscale-acl.json)
# ============================================================================

set -euo pipefail

TS_TAG="tag:server"

log()  { printf '\033[1;32m[tailscale]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[gagal]\033[0m %s\n' "$*" >&2; }

# ----------------------------------------------------------------------------
# 0. Validasi
# ----------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  err "Jalankan sebagai root: sudo bash $0"
  exit 1
fi

# ----------------------------------------------------------------------------
# 1. Install Tailscale (idempotent — aman dijalankan ulang)
# ----------------------------------------------------------------------------
if command -v tailscale >/dev/null 2>&1; then
  log "Tailscale sudah terpasang: $(tailscale version | head -n1)"
else
  log "Mengunduh installer resmi Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

systemctl enable --now tailscaled

# ----------------------------------------------------------------------------
# 2. Hubungkan STB ke tailnet
# ----------------------------------------------------------------------------
if tailscale status >/dev/null 2>&1; then
  log "STB sudah terhubung ke tailnet."
else
  log "Membuka login — salin URL yang muncul dan buka di browser (akun: satrimuhub@gmail.com)"
  tailscale up --advertise-tags="${TS_TAG}" --ssh
fi

# Re-apply tag & SSH (idempotent)
tailscale up --advertise-tags="${TS_TAG}" --ssh

# ----------------------------------------------------------------------------
# 3. Ringkasan
# ----------------------------------------------------------------------------
TS_IP="$(tailscale ip -4 2>/dev/null || echo '?')"
HOSTNAME_TS="$(tailscale status --self --json 2>/dev/null | grep -o '"HostName":"[^"]*"' | cut -d'"' -f4 || hostname)"

cat <<EOF

============================================================================
 SELESAI — STB terhubung ke Tailscale
----------------------------------------------------------------------------
 IP Tailscale : ${TS_IP}
 Hostname     : ${HOSTNAME_TS}

 Akses dari perangkat yang login Tailscale:
   - SSH (developer) : ssh root@${TS_IP}
   - Admin web       : http://${TS_IP}:11111/admin/
   - Display         : http://${TS_IP}:11111/

 LANGKAH MANUAL BERIKUTNYA (Admin Console, login satrimuhub@gmail.com):
   1. Machines → ${HOSTNAME_TS} → "..." → "Disable key expiry"
   2. Pastikan STB memakai tag ${TS_TAG}
   3. Terapkan ACL (Access Controls):

      {
        "tagOwners": {
          "tag:server":   ["satrimuhub@gmail.com"],
          "tag:dev":      ["satrimuhub@gmail.com"],
          "tag:pengurus": ["satrimuhub@gmail.com"]
        },
        "acls": [
          { "action": "accept", "src": ["tag:dev"],
            "dst": ["tag:server:22", "tag:server:11111"] },
          { "action": "accept", "src": ["tag:pengurus"],
            "dst": ["tag:server:11111"] }
        ]
      }

   4. Tag akun pengurus masjid sebagai tag:pengurus
      (Machines / Users → pilih akun mereka)
============================================================================
EOF
