// Selector integrity: the inline script must only use selectors that exist in
// the template markup. A typo or deleted element should fail this test.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const TEMPLATE = readFileSync(path.join(ROOT, 'src', 'templates', 'index.html'), 'utf-8')

describe('integritas selector template', () => {
  const selectors = [
    '#preloader',
    '#logo-row',
    '#logo-left',
    '#logo-right',
    '#logo',
    '#jam',
    '#tgl',
    '#jadwal',
    '#right-counter',
    '#count-down',
    '#display-adzan',
    '#full-screen-clock',
    '#net-banner-anchor',
    '#running-text'
  ]

  for (const sel of selectors) {
    it(`selector ${sel} ada di markup`, () => {
      const id = sel.slice(1)
      const found = TEMPLATE.includes(`id="${id}"`) || TEMPLATE.includes(`id='${id}'`)
      expect(found).toBe(true)
    })
  }

  it('flip-digit dengan data-loc ada di kedua overlay countdown', () => {
    const locs = ['min-tens', 'min-units', 'sec-tens', 'sec-units']
    for (const loc of locs) {
      const needle = `data-loc="${loc}"`
      // Each overlay (#count-down and #right-counter) must contain all 4 digits
      const count = TEMPLATE.split(needle).length - 1
      expect(count).toBeGreaterThanOrEqual(2)
    }
  })
})
