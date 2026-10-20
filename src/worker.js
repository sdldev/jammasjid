// Jam Masjid Santrimu - Cloudflare Worker entrypoint
// Router: GET / (display), POST /api/proses (API), GET /api/events (SSE)

import { DisplayHub } from './displayHub.js'
import { renderDisplay } from './lib/render.js'
import { handleProses } from './lib/proses.js'
import { storeFromEnv as logoStoreFromEnv } from './lib/logoStore.js'
// The HTML template is imported as a string via wrangler Rules (type: Text)
import template from './templates/index.html'

export { DisplayHub }

// Static assets. Media (gambar/font/audio) hampir tak pernah berubah → cache
// 30 hari agar tidak divalidasi ulang tiap muat halaman.
// Kode (js/css/json) memakai cache PENDEK: versi lama yang ter-cache 30 hari
// menutupi fitur baru setelah deploy (kasus nyata: app.js admin).
const MEDIA_CACHE_PATTERN = /\.(jpe?g|png|gif|webp|otf|ttf|woff2?|mp3)$/i
const MEDIA_CACHE_CONTROL = 'public, max-age=2592000'
const CODE_CACHE_PATTERN = /\.(js|css|json)$/i
const CODE_CACHE_CONTROL = 'public, max-age=300, must-revalidate'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/' && request.method === 'GET') {
      return renderDisplay(env, template)
    }

    if (url.pathname === '/api/proses' && request.method === 'POST') {
      return handleProses(request, env)
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
      const hubId = env.HUB.idFromName('display')
      return env.HUB.get(hubId).fetch(request)
    }

    // Logo image (KV backend; file backend di mode lokal disajikan serveStatic
    // langsung dari public/img). Cache 30 hari — versi diganti lewat ?v= di URL.
    const logoMatch = url.pathname.match(/^\/logo\/(left|right)$/)
    if (logoMatch && request.method === 'GET') {
      const store = logoStoreFromEnv(env)
      const data = store && store.backend === 'kv' ? await store.load(logoMatch[1]) : null
      if (!data) return new Response('Not found', { status: 404 })
      return new Response(data.buffer, {
        headers: {
          'Content-Type': data.contentType,
          'Cache-Control': MEDIA_CACHE_CONTROL
        }
      })
    }

    // Fall back to static assets
    const response = await env.ASSETS.fetch(request)
    const isMedia = MEDIA_CACHE_PATTERN.test(url.pathname)
    const isCode = CODE_CACHE_PATTERN.test(url.pathname)
    if (response.status === 200 && (isMedia || isCode)) {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', isMedia ? MEDIA_CACHE_CONTROL : CODE_CACHE_CONTROL)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    }
    // Jangan diindeks mesin pencari (cadangan bagi meta robots di HTML).
    if (response.status === 200 && /\.html?($|\?)/i.test(url.pathname)) {
      const headers = new Headers(response.headers)
      headers.set('X-Robots-Tag', 'noindex, nofollow')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    }
    return response
  }
}
