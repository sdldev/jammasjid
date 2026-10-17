// Stub for the "cloudflare:workers" runtime module when testing under Node
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }
}
