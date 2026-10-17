# AGENTS.md — Jam Masjid Santrimu

Digital clock + prayer schedule for a mosque display. One codebase runs in **two
runtimes** with identical routes and handlers:

- **Local/offline** — `bun src/server.mjs` (Bun ≥ 1.1, systemd on Armbian/STB), file storage.
- **Cloudflare Workers** — `src/worker.js`, KV + Durable Object, deployed with Wrangler via Bun.

`src/lib/*` is shared Web-API code (Request/Response) and must stay runtime-agnostic.
Only `src/local/env.mjs` (local) and `src/displayHub.js` (Workers) may contain
runtime-specific infrastructure.

## Commands

```sh
bun install
cp .env.example .env        # set AUTH_SECRET (required) and optionally PORT (default 11111)
bun run start               # local server → http://localhost:11111/ and /admin/
bun run test                # vitest run (16 files, ~97 tests)
bun run dev                 # wrangler dev --port 11111 (needs `bun run seed` first)
bun run seed                # push db/database.json → local KV; add `-- --remote` for prod
bun run deploy              # wrangler deploy
```

There is **no lint, typecheck, or build step**. Verify changes with `bun run test` and
`bun run deploy -- --dry-run` when touching Worker code.

Focused/simulated-time tests:

```sh
bun --bun x vitest run test/proses.test.js
UJI_MODE=sim bun run test            # fake clock for prayer-pipeline tests
```

`test/uji-real-waktu.test.js` auto-skips unless `UJI_MODE` is set — keep it that way.
In sim mode the schedule is fixed to `SIM_PRAYER_TIMES` in `test/display-harness.js`;
`UJI_JAM` must match it for the chosen `UJI_PRAYER` or the test fails fast with a
clear message.

## Layout

```
src/worker.js            Worker entrypoint (routes mirror server.mjs)
src/server.mjs           Local Node server: router, static files, SSE, scheduler start
src/local/env.mjs        Local adapter: KV→db/database.json, HUB→in-process SSE, .env loader
src/displayHub.js        Durable Object SSE hub (Workers only)
src/lib/render.js        Injects db into src/templates/index.html
src/lib/proses.js        POST /api/proses dispatcher (all admin/display operations)
src/lib/db.js            getDb/putDb (shallow merge with DEFAULT_DB), hashDb (sha1)
src/lib/auth.js          Stateless HMAC-SHA256 session cookie `dm_session` (7 days)
src/lib/kemenag.js       bimasislam.kemenag.go.id client (session, monthly schedule)
src/lib/jadwalStore.js   Official-schedule storage (file or KV), rolling ~3 months
src/lib/logoStore.js     Logo storage (kiri/kanan judul): file lokal / KV Workers
src/lib/scheduler.mjs    Local-only daily Kemenag sync at 04:30
src/templates/index.html Display page: markup + ALL client logic inline
public/admin/            Admin SPA (hash router, jQuery, POSTs to /api/proses)
public/masjid/           Vendored jQuery, Moment, PrayTimes + display CSS
db/database.json         Configuration document (local storage / seed source)
db/jadwal-sholat.json    Official prayer schedule (rolling window)
test/                    Vitest suites + display-harness.js (runs the inline script)
deploy/masjid-display.service  systemd unit (server Bun)
deploy/masjid-kiosk.service    systemd unit (Chromium kiosk + flag anti-notifikasi)
scripts/install.sh             installer Armbian: apt upgrade/cleanup, Bun, Chromium, systemd
scripts/update.sh              update in-place: git pull + install + restart + rollback
```

## Data rules

- `db/database.json` is **configuration only**. `jadwal_resmi` must never be stored
  there — `getDb`/`putDb` transparently attach/split it via `jadwalStore.js`
  (local file `db/jadwal-sholat.json`, Workers KV key `jadwal-sholat`). Write through
  `putDb`, never by editing the split files directly.
- `getDb` shallow-merges stored data with `DEFAULT_DB`. A new top-level config key
  needs a default there (nested objects like `kemenag` are merged explicitly).
- `logo` (`{left, right}` URL, optional logos beside the mosque name) is the third
  dual-backend store (`logoStore.js`: file in `public/img` locally, base64 in KV
  on Workers served via `GET /logo/:side`). Upload goes through the `logoUpload`
  multipart handler in `proses.js`; URL carries `?v=` for cache-busting (media
  cached 30 days).
- Official Kemenag schedule (`jadwal_resmi['YYYY-MM-DD']`) takes priority over
  browser-side PrayTimes; PrayTimes is the offline fallback. Keep that order.
- `time_offset_ms` corrects RTC-less STBs. In display code always use `app.now()`,
  never bare `moment()`, for clock reads.

## API and auth contract

- `POST /api/proses` **always returns HTTP 200** with `{success, registered, data}`
  — the jQuery admin relies on `.done()` firing. Do not change this shape.
- Dispatch via `HANDLERS` in `src/lib/proses.js`. Add new ids there and to
  `PUBLIC_HANDLERS` only if they truly need to work before login.
- Form bodies use jQuery bracket notation (`dt[formId]`, `dt[index]`), expanded by
  `parseFormBody`. `index` is `no-index` (merge object), `new` (append), or numeric.
- **Every mutation must call `notifyHub()`** (and cache invalidation where relevant),
  otherwise displays stay stale until the 5-minute hash check.
- Session is a signed cookie, not server state; there is no logout store to clear.

## Display template rules

- `src/templates/index.html` is imported as text (Wrangler `rules`) / read with `fs`
  and passed to `renderDisplay`. Required placeholders: `__LAT__`, `__LNG__`,
  `__TIMEZONE__`, `__DST__`, `__MASJID_NAME__`, `'__PRAY_TIMES_ADJUST__'`,
  `'__PRAY_TIMES_TUNE__'`, `__DB_JSON__`. `renderDisplay` throws if one is missing.
- Keep `escapeHtml`/`safeJson` for injected values — they prevent breaking out of
  markup/`<script>`.
- All display logic is in the **first** `<script>` block. `test/display-harness.js`
  extracts that block and runs it with a jQuery/DOM stub. Do not add another inline
  `<script>` before it; add new client code inside it (or a separate file) instead.
- Pipeline: Menuju Adzan → Adzan → Iqomah → main display, triggered per second by
  second-range windows (not exact-second matching). Friday Dhuhr returns straight to
  the main display after adhan — there is **no khutbah feature** (README is stale here).
- Media files get a 30-day cache from a regex duplicated in **both** `src/worker.js`
  and `src/server.mjs`; update both lists when adding a media extension.
- SSE contract: `/api/events` emits `db-changed`; local hub mirrors the Durable
  Object interface (`HUB.idFromName('display').get().notify()`). Preserve it so
  `proses.js` stays runtime-agnostic.

## Conventions and gotchas

- Comments and user-facing strings are **Indonesian**; keep that style. Identifiers
  are mixed Indonesian/English (e.g. `putDb`, `buangUsang`, `jadwal_resmi`).
- **Runtime is Bun, not Node.** No `"type": "module"` in `package.json` because Bun
  detects ESM automatically. The systemd unit calls `/root/.bun/bin/bun`; adjust the
  path per installation.
- `bun.lock` is the committed lockfile; `package-lock.json` is gitignored so a stray
  `npm install` does not reintroduce a conflicting npm lockfile.
- `bun test` is NOT compatible with this suite — it lacks `vi.setSystemTime`,
  `vi.useFakeTimers`, and other vitest APIs used by `test/display-harness.js`. Keep
  using `vitest run` (via `bun --bun x vitest run` / `bun run test`).
- `src/lib/jadwalStore.js` imports `node:fs`/`node:path`. That is tolerated in the
  Worker bundle only because the file store is never instantiated there; Wrangler
  prints a `nodejs_compat` warning on dry-run. Don't add new Node imports to shared
  `src/lib/*` — put Node-only code in `src/local/`.
- Local writes are atomic (tmp file + rename) in both the db adapter and the schedule
  store; keep that pattern.
- Admin credentials: user `admin`, password dari `env.ADMIN_PASS` (lokal `.env`,
  Workers secret). `db.akses.pass` **kosong secara default** dan hanya terisi
  setelah operator ganti password lewat admin (`adminPassword()` di `db.js`
  memilih: nilai tersimpan > env > `admin1234`). Login **ditolak** selama
  password masih `admin1234` (`mustChangePass()`), jadi repo publik tidak
  membocorkan kredensial yang bisa dipakai. `AUTH_SECRET` default adalah nilai
  dev — never deploy with it.
- Kemenag sync runs **only in local mode** (in-process scheduler at 04:30). In Workers
  it must be triggered manually from the admin or via a cron trigger.
- `UJI_TANGGAL` (scheduler tests) and `UJI_MODE`/`UJI_JAM` (display tests) are test-only
  env vars; never rely on them in production paths.
- `.zcode/` is gitignored; don't commit editor/agent artifacts.

## Before changing sensitive areas

Read `README.md` for the full architecture and the Cloudflare↔local binding mapping.
Note that it is stale in places (khutbah feature, wallpaper carousel); the code and
tests are authoritative. Key files to read first: `src/lib/proses.js`, `src/lib/db.js`,
`src/lib/render.js`, and `test/display-harness.js`.
