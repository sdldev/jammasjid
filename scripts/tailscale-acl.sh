#!/usr/bin/env bash
# =============================================================================
# tailscale-acl.sh — Terapkan ACL tailnet Jam Masjid dari file JSON
#
# Pemakaian:
#   sudo bash scripts/tailscale-acl.sh db/tailscale-acl.json
#
# File JSON di-generate oleh server (src/local/tailscaleSync.mjs) berdasarkan
# db.tailscale.pengurus_emails. Berisi ACL minimal:
#   - tag:dev      → SSH (22) + admin web (11111)
#   - tag:pengurus → admin web (11111) saja
#
# Skrip ini mencoba:
#   1. OAuth client (TS_CLIENT_ID + TS_CLIENT_SECRET di .env — TIDAK kedaluwarsa,
#      cocok untuk perangkat tahunan; token akses sesaat diminta per panggilan)
#   2. API key (TS_API_KEY — fallback; ingat: kedaluwarsa maks 90 hari)
#   3. fallback terakhir: mencetak instruksi manual + JSON siap tempel
#
# Output akhir SELALU JSON satu baris:
#   {"ok":true,"ip":"100.x.x.x"}        → ACL diterapkan via API
#   {"ok":false,"message":"...","manual":true} → butuh langkah manual
# =============================================================================
set -euo pipefail

ACL_FILE="${1:?butuh path file ACL JSON}"

[ -f "$ACL_FILE" ] || { echo '{"ok":false,"message":"file ACL tidak ditemukan"}'; exit 0; }
command -v tailscale >/dev/null 2>&1 || { echo '{"ok":false,"message":"tailscale belum terpasang"}'; exit 0; }
command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"message":"jq belum terpasang"}'; exit 0; }

TS_IP="$(tailscale ip -4 2>/dev/null || true)"

# Muat kredensial dari .env (root repo = dua level di atas skrip)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
baca_env() {
  grep -E "^$1=" "$ROOT/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
if [ -f "$ROOT/.env" ]; then
  TS_API_KEY="$(baca_env TS_API_KEY)"
  TS_CLIENT_ID="$(baca_env TS_CLIENT_ID)"
  TS_CLIENT_SECRET="$(baca_env TS_CLIENT_SECRET)"
fi
TS_API_KEY="${TS_API_KEY:-}"
TS_CLIENT_ID="${TS_CLIENT_ID:-}"
TS_CLIENT_SECRET="${TS_CLIENT_SECRET:-}"
TAILNET="${TS_TAILNET:--}"   # '-' = tailnet default

# --- dapatkan access token ---------------------------------------------------
# Prioritas: OAuth client (tidak kedaluwarsa) → API key (90 hari).
TOKEN=""
if [ -n "$TS_CLIENT_ID" ] && [ -n "$TS_CLIENT_SECRET" ]; then
  TOKEN_RESP="$(curl -sS -m 20 -X POST "https://api.tailscale.com/api/v2/oauth/token" \
    -u "${TS_CLIENT_ID}:${TS_CLIENT_SECRET}" \
    -d 'grant_type=client_credentials' 2>/dev/null || true)"
  TOKEN="$(printf '%s' "$TOKEN_RESP" | jq -r '.access_token // empty' 2>/dev/null || true)"
  if [ -z "$TOKEN" ]; then
    jq -cn --arg m "OAuth Tailscale gagal (cek TS_CLIENT_ID/TS_CLIENT_SECRET): $(printf '%s' "$TOKEN_RESP" | head -c 200)" \
      '{ok:false, message:$m, manual:true}'
    exit 0
  fi
elif [ -n "$TS_API_KEY" ]; then
  TOKEN="$TS_API_KEY"
fi

if [ -n "$TOKEN" ]; then
  BODY="$(jq -c '.' "$ACL_FILE")"
  RESP="$(curl -sS -m 20 \
    -X POST "https://api.tailscale.com/api/v2/tailnet/${TAILNET}/acl" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$BODY" 2>/dev/null || true)"
  if [ -z "$RESP" ] || echo "$RESP" | grep -q '"acls"'; then
    jq -cn --arg ip "$TS_IP" '{ok:true, ip:$ip}'
    exit 0
  fi
  MSG="$(echo "$RESP" | head -c 200)"
  jq -cn --arg m "API Tailscale menolak: $MSG" '{ok:false, message:$m, manual:true}'
  exit 0
fi

# Tanpa kredensial: instruksikan manual (JSON siap tempel ada di ACL_FILE).
jq -cn --arg f "$ACL_FILE" --arg ip "$TS_IP" \
  '{ok:false, manual:true, ip:$ip, message:"Belum ada kredensial Tailscale di .env — salin isi " + $f + " ke https://login.tailscale.com/admin/acls lalu Simpan. Untuk otomatis permanen, buat OAuth client (Settings → OAuth clients, scope ACL) lalu isi TS_CLIENT_ID dan TS_CLIENT_SECRET."}'
