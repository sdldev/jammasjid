// Local server replacing Cloudflare Workers (Linux/Armbian, Node 18+).
// Routes mirror src/worker.js:
//   GET  /            → display page (template + injected db)
//   POST /api/proses  → admin/display API (same handlers as Workers)
//   GET  /api/events  → SSE realtime (local hub, replaces Durable Object)
//   anything else     → static files from public/

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLocalEnv } from './local/env.mjs'
import { renderDisplay } from './lib/render.js'
import { handleProses } from './lib/proses.js'
import { startScheduler } from './lib/scheduler.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')
const TEMPLATE = readFileSync(join(ROOT, 'src', 'templates', 'index.html'), 'utf8')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json'
}

// Static assets (media + css/js): 30-day browser cache (same rule as worker.js)
const MEDIA_CACHE_PATTERN = /\.(jpe?g|png|gif|webp|otf|ttf|woff2?|mp3|css|js|json)$/i
const MEDIA_CACHE_CONTROL = 'public, max-age=2592000'

const env = createLocalEnv()

// Send a Web Response (from render.js/proses.js) through node:http
async function sendWebResponse(res, webRes) {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()))
  if (webRes.body) {
    res.end(Buffer.from(await webRes.arrayBuffer()))
  } else {
    res.end()
  }
}

// Convert a node:http request into a Web Request (for handleProses)
function toWebRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    duplex: 'half'
  })
}

function serveStatic(req, res, pathname) {
  // Normalize and block path traversal outside public/
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(PUBLIC_DIR, rel)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  // html_handling "auto-trailing-slash": /admin/ → /admin/index.html
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html')
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
    return
  }
  const headers = { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' }
  if (MEDIA_CACHE_PATTERN.test(filePath)) headers['Cache-Control'] = MEDIA_CACHE_CONTROL
  res.writeHead(200, headers)
  res.end(readFileSync(filePath))
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write('retry: 3000\n\n')
  env.HUB.clients.add(res)
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, 30_000)
  res.on('close', () => {
    clearInterval(heartbeat)
    env.HUB.clients.delete(res)
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    if (url.pathname === '/' && req.method === 'GET') {
      return sendWebResponse(res, await renderDisplay(env, TEMPLATE))
    }
    if (url.pathname === '/api/proses' && req.method === 'POST') {
      return sendWebResponse(res, await handleProses(toWebRequest(req), env))
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      return handleEvents(req, res)
    }
    // Logo dari KV backend (fallback bila LOGO_STORE tidak file-based);
    // mode lokal normalnya file di public/img → disajikan serveStatic di bawah.
    const logoMatch = url.pathname.match(/^\/logo\/(left|right)$/)
    if (logoMatch && req.method === 'GET' && env.LOGO_STORE && env.LOGO_STORE.backend === 'kv') {
      const data = await env.LOGO_STORE.load(logoMatch[1])
      if (!data) { res.writeHead(404).end('Not found'); return }
      res.writeHead(200, {
        'Content-Type': data.contentType,
        'Cache-Control': MEDIA_CACHE_CONTROL
      })
      res.end(Buffer.from(data.buffer))
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, decodeURIComponent(url.pathname))
    }
    res.writeHead(405).end('Method not allowed')
  } catch (err) {
    console.error('[server]', err)
    if (!res.headersSent) res.writeHead(500)
    res.end('Internal server error')
  }
})

server.listen(env.PORT, () => {
  console.log(`Display  : http://localhost:${env.PORT}/`)
  console.log(`Admin    : http://localhost:${env.PORT}/admin/`)
  startScheduler(env)
})
