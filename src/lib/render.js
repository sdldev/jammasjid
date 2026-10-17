// Render the display page by injecting db values into the HTML template.
// Placeholders mirror the PHP originals: lat/lng/timeZone/dst, prayTimesAdjust, app.db.
// The template is passed in as a parameter: Workers import it via wrangler Rules,
// the local server reads it with fs — both call renderDisplay(env, template).

import { getDb } from './db.js'

// Escape "<" so injected JSON can never close the <script> tag early.
function safeJson(value) {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c')
}

// HTML-escape values injected directly into markup (not inside <script>)
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toNumberOrKeyword(value) {
  const num = Number(value)
  if (!Number.isNaN(num) && String(value).trim() !== '') return String(num)
  return JSON.stringify(String(value)) // e.g. dst: "auto"
}

function prayTimesAdjustForDisplay(db) {
  // Mirrors proses.php getPraySetting: only non-empty values are applied.
  const adjust = {}
  for (const [key, value] of Object.entries(db.prayTimesAdjust || {})) {
    if (String(value).trim().length > 0) adjust[key] = value
  }
  return adjust
}

function prayTimesTuneForDisplay(db) {
  // Numeric values only; 0 does not change the schedule but is still sent so
  // prayTimes.tune() receives every time key (fajr..isha).
  const tune = {}
  for (const [key, value] of Object.entries(db.prayTimesTune || {})) {
    tune[key] = Number(value) || 0
  }
  return tune
}

export async function renderDisplay(env, template) {
  if (!template) throw new Error('renderDisplay requires an HTML template parameter')
  const db = await getDb(env)
  const setting = db.setting

  const replacements = {
    __LAT__: String(Number(setting.latitude)),
    __LNG__: String(Number(setting.longitude)),
    __TIMEZONE__: toNumberOrKeyword(setting.timeZone),
    __DST__: toNumberOrKeyword(setting.dst),
    __MASJID_NAME__: escapeHtml(setting.nama),
    "'__PRAY_TIMES_ADJUST__'": safeJson(prayTimesAdjustForDisplay(db)),
    "'__PRAY_TIMES_TUNE__'": safeJson(prayTimesTuneForDisplay(db)),
    __DB_JSON__: safeJson(db)
  }

  let html = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!html.includes(placeholder)) {
      throw new Error(`Placeholder ${placeholder} not found in template`)
    }
    // Function form: db values are never interpreted as $& / $' patterns
    html = html.replace(placeholder, () => value)
  }

  // 60-second cache: efficient for multiple screens.
  // The "cache-display" key enables active invalidation when the db changes,
  // so manual JSON edits in the Cloudflare dashboard (KV) still appear within
  // at most 60 seconds.
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'Cache-Tag': 'cache-display',
    'CDN-Cache-Tag': 'cache-display'
  }
  return new Response(html, { headers })
}
