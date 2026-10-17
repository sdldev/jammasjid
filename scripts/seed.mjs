// Seed: push db/database.json ke Cloudflare KV sebagai key "database".
// Local usage : bun run seed                 → local KV (for wrangler dev)
// Remote usage: bun run seed -- --remote     → KV namespace on Cloudflare
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dbFile = path.join(root, 'db', 'database.json')

if (!existsSync(dbFile)) {
  console.error('File db/database.json tidak ditemukan.')
  process.exit(1)
}

// Validate JSON before pushing
JSON.parse(readFileSync(dbFile, 'utf-8'))

const extraArgs = process.argv.slice(2)
// Wrangler v4: write through the binding declared in wrangler.jsonc
const args = ['wrangler', 'kv', 'key', 'put', 'database', '--binding', 'DATABASE', '--path', dbFile, ...extraArgs]
const cmd = process.platform === 'win32' ? 'bunx.cmd' : 'bunx'
const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('Seed selesai: key "database" berhasil ditulis ke KV.')
