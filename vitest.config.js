import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // The workerd runtime module is replaced by a stub when testing under Node
      'cloudflare:workers': path.join(root, 'test', 'cloudflare-workers-stub.js')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js']
    // test/uji-real-waktu.test.js skips automatically without UJI_MODE/UJI_JAM
    // so the regression suite never waits hours for real prayer windows
  }
})
