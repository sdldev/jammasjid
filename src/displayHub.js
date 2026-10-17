// DisplayHub: Durable Object broadcasting db changes to all display screens via SSE.
// Replaces the 1s polling loop (changeDbCheck) from the PHP version.
// Extending DurableObject is required so the worker can call the notify RPC.

import { DurableObject } from 'cloudflare:workers'

const PING_INTERVAL_MS = 30_000

export class DisplayHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.controllers = new Set()
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/events' || request.method !== 'GET') {
      return new Response('Not found', { status: 404 })
    }

    const encoder = new TextEncoder()
    let heartbeat = null
    let controllerRef = null

    const stream = new ReadableStream({
      start: (controller) => {
        controllerRef = controller
        this.controllers.add(controller)
        // Short retry so EventSource reconnects quickly after a drop
        controller.enqueue(encoder.encode('retry: 3000\n\n'))
        // Heartbeat comment keeps the connection alive
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          } catch {
            this.drop(controller)
          }
        }, PING_INTERVAL_MS)
      },
      cancel: () => {
        clearInterval(heartbeat)
        if (controllerRef) this.drop(controllerRef)
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
  }

  drop(controller) {
    this.controllers.delete(controller)
  }

  // Called by the worker after a successful db mutation → every screen reloads
  async notify() {
    const encoder = new TextEncoder()
    const payload = encoder.encode('event: db-changed\ndata: 1\n\n')
    for (const controller of [...this.controllers]) {
      try {
        controller.enqueue(payload)
      } catch {
        this.drop(controller)
      }
    }
  }
}
