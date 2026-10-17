import { describe, it, expect } from 'vitest'
import { DEFAULT_DB, getDb, putDb, hashDb, sha1Hex } from '../src/lib/db.js'
import { makeEnv } from './helpers.js'

describe('db layer', () => {
  it('getDb returns DEFAULT_DB when KV empty', async () => {
    const env = makeEnv()
    expect(await getDb(env)).toEqual(DEFAULT_DB)
  })

  it('getDb returns stored db after putDb', async () => {
    const env = makeEnv()
    const db = { ...DEFAULT_DB, setting: { ...DEFAULT_DB.setting, nama: 'Masjid Test' } }
    await putDb(env, db)
    const result = await getDb(env)
    expect(result.setting.nama).toBe('Masjid Test')
  })

  it('sha1Hex matches PHP sha1 for known input', async () => {
    // sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
    expect(await sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('hashDb returns sha1 + length of db JSON', async () => {
    const env = makeEnv()
    const db = await getDb(env)
    const combine = JSON.stringify(db)
    const expected = (await sha1Hex(combine)) + String(combine.length)
    expect(await hashDb(db)).toBe(expected)
  })
})
