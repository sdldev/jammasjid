// Time-separator consistency tests:
// - countdowns (pre-adhan & iqomah) use ":" between minutes & seconds
// - the main clock uses ":" between hours & minutes
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const template = readFileSync(path.join(root, 'src', 'templates', 'index.html'), 'utf-8')

describe('pembatas titik dua (:)', () => {
  it('kedua overlay countdown punya pemisah ":" antara kelompok menit dan detik', () => {
    // The colon stands between the minutes (.ii) and seconds (.ss) groups
    const pola = /<span class="flip-label">MENIT<\/span><\/div>\s*<div class="flip-colon">:<\/div>\s*<div class="ss">/
    const jumlah = (template.match(new RegExp(pola.source, 'g')) || []).length
    expect(jumlah).toBe(2) // #count-down dan #right-counter
  })

  it('jam utama memakai HH:mm (bukan HH.mm)', () => {
    expect(template).not.toContain('HH.mm')
    expect(template).toContain('HH:mm')
  })

  it('render jam utama tidak menyisakan bracket literal "[]" (escape moment bukan HTML)', () => {
    // Bug: .html(jamStr + "[<div>]" + secStr + "[</div>]") menampilkan "00:54[]47[]".
    // Tanda [..] hanya berlaku di format string moment, bukan di string HTML.
    expect(template).not.toContain('"[<div>]"')
    expect(template).not.toContain('"[</div>]"')
    // Render aktual: HH:mm diikuti <div>detik</div> tanpa bracket
    expect(template).toContain("'<div>' + secStr + '</div>'")
  })
})
