import { describe, it, expect } from 'vitest'
import { DisplayHub } from '../src/displayHub.js'

// DO without the ctx/env constructor — call the internal methods directly
function makeHub() {
  const hub = Object.create(DisplayHub.prototype)
  hub.controllers = new Set()
  return hub
}

function sseRequest() {
  return new Request('https://x.test/api/events', {
    headers: { Accept: 'text/event-stream' }
  })
}

async function readNext(reader, decoder = new TextDecoder()) {
  const { value } = await reader.read()
  return decoder.decode(value)
}

describe('DisplayHub', () => {
  it('GET /api/events membuka stream SSE dengan retry', async () => {
    const hub = makeHub()
    const res = await hub.fetch(sseRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const reader = res.body.getReader()
    expect(await readNext(reader)).toContain('retry: 3000')
    await reader.cancel()
  })

  it('path selain /api/events → 404', async () => {
    const hub = makeHub()
    const res = await hub.fetch(new Request('https://x.test/lainnya'))
    expect(res.status).toBe(404)
  })

  it('notify mengirim db-changed ke semua koneksi aktif', async () => {
    const hub = makeHub()
    const resA = await hub.fetch(sseRequest())
    const resB = await hub.fetch(sseRequest())
    const readerA = resA.body.getReader()
    const readerB = resB.body.getReader()
    await readNext(readerA) // buang retry
    await readNext(readerB)

    await hub.notify()
    const eventA = await readNext(readerA)
    const eventB = await readNext(readerB)
    expect(eventA).toContain('event: db-changed')
    expect(eventB).toContain('event: db-changed')
    await readerA.cancel()
    await readerB.cancel()
  })

  it('koneksi yang ditutup dibersihkan dari daftar saat notify', async () => {
    const hub = makeHub()
    const res = await hub.fetch(sseRequest())
    const reader = res.body.getReader()
    expect(hub.controllers.size).toBe(1)
    await reader.cancel()
    await hub.notify() // controller yang sudah cancel dibuang
    expect(hub.controllers.size).toBe(0)
  })
})
