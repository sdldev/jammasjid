// Shared harness for display-layer tests: runs the inline script from
// src/templates/index.html in a sandbox with stubbed jQuery/DOM + real moment.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
export const moment = require(path.join(root, 'public', 'masjid', 'moment.min.js'))

const TEMPLATE = readFileSync(path.join(root, 'src', 'templates', 'index.html'), 'utf-8')

export function extractInlineScript(template) {
  const match = template.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('Script inline template tidak ditemukan')
  return match[1]
}

// .full-screen group selectors on the display page — equivalent to class="full-screen"
const FULL_SCREEN_SELECTORS = ['#count-down', '#display-adzan']

// jQuery stub: records each selector's visibility (show/fadeIn/slideDown = shown,
// hide/fadeOut/slideUp = hidden) so assertions run without a real DOM.
export function makeJquery(state) {
  state.alias = state.alias || {}
  const resolveAlias = (s) => state.alias[s] || s

  const chain = (rawSel) => {
    const sel = resolveAlias(String(rawSel))
    const api = {
      show() { state.visible[sel] = true; state.calls.push([sel, 'show']); return api },
      hide() { state.visible[sel] = false; state.calls.push([sel, 'hide']); return api },
      fadeIn() { state.visible[sel] = true; state.calls.push([sel, 'fadeIn']); return api },
      fadeOut() { state.visible[sel] = false; state.calls.push([sel, 'fadeOut']); return api },
      slideDown() { state.visible[sel] = true; state.calls.push([sel, 'slideDown']); return api },
      slideUp() { state.visible[sel] = false; state.calls.push([sel, 'slideUp']); return api },
      is() { return !!state.visible[sel] },
      length: 1,
      addClass(c) { state.classes = state.classes || {}; (state.classes[sel] = state.classes[sel] || new Set()).add(c); state.calls.push([sel, 'addClass:' + c]); return api },
      removeClass(c) { if (state.classes && state.classes[sel]) state.classes[sel].delete(c); state.calls.push([sel, 'removeClass:' + c]); return api },
      toggleClass(c, force) {
        state.classes = state.classes || {}
        const set = state.classes[sel] = state.classes[sel] || new Set()
        const shouldAdd = force !== undefined ? !!force : !set.has(c)
        if (shouldAdd) set.add(c)
        else set.delete(c)
        state.calls.push([sel, 'toggleClass:' + c + ':' + shouldAdd])
        return api
      },
      delay() { return api },
      text(v) { if (v === undefined) return state.texts[sel] || ''; state.texts[sel] = String(v); state.calls.push([sel, 'text']); return api },
      html(v) { if (v === undefined) return state.texts[sel] || ''; state.texts[sel] = String(v); state.calls.push([sel, 'html']); return api },
      empty() { return api },
      append() { return api },
      // appendTo(target): register this element under its own selector so later
      // assertions can find it (e.g. $('<div id="net-status">').appendTo('body')).
      appendTo(target) {
        const m = String(rawSel).match(/id=["']([^"']+)["']/)
        if (m) {
          const ownSel = '#' + m[1]
          // Map the raw $('<div id="x">') selector to the canonical '#x' so that
          // later $(rawSel) calls resolve to the same recorded state.
          state.alias[String(rawSel)] = ownSel
          state.visible[ownSel] = state.visible[rawSel] !== undefined ? state.visible[rawSel] : true
        }
        return api
      },
      css() { return api },
      on() { return api },
      one() { return api },
      // attr(name) → catat di state.attrs; attr(name, value) → simpan; removeAttr → hapus.
      // Dipakai showLogo() utk set/hapus src pada #logo-left/#logo-right.
      attr(name, value) {
        state.attrs = state.attrs || {}
        if (value === undefined) return state.attrs[sel] ? state.attrs[sel][name] : undefined
        state.attrs[sel] = state.attrs[sel] || {}
        state.attrs[sel][name] = String(value)
        state.calls.push([sel, 'attr:' + name])
        return api
      },
      removeAttr(name) {
        if (state.attrs && state.attrs[sel]) delete state.attrs[sel][name]
        state.calls.push([sel, 'removeAttr:' + name])
        return api
      },
      find(sub) { const s = `${sel} ::find ${sub}`; state.found = state.found || []; state.found.push(s); return chain(s) },
      first() { return api },
      each() { return api },
      outerWidth() { return 0 }
    }
    // Raw element access like jQuery (`$x[0]`): reading `offsetWidth` is used in
    // production as a forced reflow to restart CSS animation — recorded so tests
    // can assert that every flip passes through a reflow before re-adding the class.
    api[0] = {}
    Object.defineProperty(api[0], 'offsetWidth', {
      get() { state.reflows = state.reflows || []; state.reflows.push(sel); return 0 }
    })
    return api
  }
  const $ = (sel) => {
    if (typeof sel === 'function') { sel(); return chain('.init') }
    sel = String(sel)
    // Group selector: fan out to each full-screen overlay (real jQuery behavior)
    if (sel === '.full-screen') {
      const apis = FULL_SCREEN_SELECTORS.map((s) => chain(s))
      return new Proxy(apis[0], {
        get(_target, prop) {
          return (...args) => {
            const results = apis.map((a) => a[prop](...args))
            // is() on a group is true when any member is visible (jQuery semantics)
            return prop === 'is' ? results.some(Boolean) : chain(sel)
          }
        }
      })
    }
    return chain(sel)
  }
  $.parseJSON = JSON.parse
  $.each = (obj, cb) => {
    for (const key in obj) {
      if (cb.call(obj[key], key, obj[key]) === false) break
    }
  }
  // Record the $.post success callback so tests can simulate server responses.
  $.post = (url, _data, success) => {
    state.posts.push(url)
    state.lastPostSuccess = typeof success === 'function' ? success : null
    return {
      done() { return this },
      fail() { return this }
    }
  }
  // Record $.ajax callbacks (done/fail/always) so tests can simulate both
  // success and offline/timeout paths. lastPostSuccess is kept as an alias
  // of lastAjaxDone for backward compatibility with existing tests.
  $.ajax = (opts) => {
    state.posts.push(opts.url)
    const result = {
      done(cb) { state.lastAjaxDone = cb; state.lastPostSuccess = cb; return result },
      fail(cb) { state.lastAjaxFail = cb; return result },
      always(cb) { state.lastAjaxAlways = cb; return result }
    }
    return result
  }
  return $
}

class FakeEventSource {
  constructor() {}
  addEventListener() {}
}

class FakeAudio {
  constructor(state) { this.currentTime = 0; this.state = state }
  play() { this.state.audioPlays = (this.state.audioPlays || 0) + 1; return Promise.resolve() }
  pause() {}
}

export function baseDb(overrides = {}) {
  return {
    prayName: { fajr: 'Subuh', sunrise: 'Shuruq', dhuhr: 'Dzuhur', asr: 'Ashar', maghrib: 'Maghrib', isha: "Isya'" },
    timeName: { Hours: 'Jam', Minutes: 'Menit', Seconds: 'Detik' },
    dayName: { Sunday: 'Ahad', Monday: 'Senin', Tuesday: 'Selasa', Wednesday: 'Rabu', Thursday: 'Kamis', Friday: "Jum'at", Saturday: 'Sabtu' },
    monthName: { January: 'Januari', February: 'Februari', March: 'Maret', April: 'April', May: 'Mei', June: 'Juni', July: 'Juli', August: 'Agustus', September: 'September', October: 'Oktober', November: 'November', December: 'Desember' },
    timer: { wait_adzan: 1, adzan: 3 },
    iqomah: { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10 },
    running_text: [],
    kas: null,
    ...overrides
  }
}

// PrayTimes stub schedule for simulation mode (bootApp). Tests that compute
// time windows MUST use this constant to stay consistent with the schedule the
// app sees at boot — a mismatch causes missed/empty phases.
export const SIM_PRAYER_TIMES = {
  fajr: '04:30', sunrise: '05:50', dhuhr: '12:00', asr: '15:00', maghrib: '18:00', isha: '19:10'
}

// Run the template script in a sandbox; return the app object + jQuery state.
export function bootApp(db, nowIso) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(nowIso))

  let code = extractInlineScript(TEMPLATE)
  code = code
    .replace(/__LAT__/g, '-5.59')
    .replace(/__LNG__/g, '105.5')
    .replace(/__TIMEZONE__/g, '7')
    .replace(/__DST__/g, '0')
    .replace("'__PRAY_TIMES_ADJUST__'", '"{}"')
    .replace("'__PRAY_TIMES_TUNE__'", '"{}"')
    .replace(/__DB_JSON__/g, JSON.stringify(JSON.stringify(db)))

  const state = {
    visible: {}, calls: [], posts: [], texts: {}, found: [], reflows: [],
    reloads: 0, lastPostSuccess: null, lastAjaxDone: null, lastAjaxFail: null,
    lastAjaxAlways: null, audioPlays: 0, alias: {}
  }
  const $ = makeJquery(state)
  const fakeDocument = { getElementById: () => null }
  const fakePrayTimes = {
    adjust() {},
    tune() {},
    getTimes: () => ({ ...SIM_PRAYER_TIMES })
  }

  const fakeLocation = { reload: () => { state.reloads++ } }
  const run = new Function(
    '$', 'moment', 'EventSource', 'Audio', 'document', 'prayTimes', 'console', 'location',
    code + '\n;return app;'
  )
  // Audio factory: `new Audio(url)` in the template must create a FakeAudio bound to state.
  const AudioFactory = function() { return new FakeAudio(state) }
  const app = run($, moment, FakeEventSource, AudioFactory, fakeDocument, fakePrayTimes, console, fakeLocation)
  // Let the first tick populate the schedule (app.fajr..app.isha)
  vi.advanceTimersByTime(1100)
  return { app, state }
}
