import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateKeyPair,
  signLicense,
  verifyLicense,
  type LicensePayload
} from '../src/main/license/core'
import { LicenseManager } from '../src/main/license'
import { tmpDir } from './helpers/fakes'

const pair = generateKeyPair()
const other = generateKeyPair()
const payload: LicensePayload = {
  v: 1,
  product: 'ai-hub',
  id: 'ORDER-1',
  name: 'Jane Buyer',
  email: 'jane@example.com',
  issuedAt: '2026-01-01T00:00:00.000Z'
}

describe('license verification', () => {
  it('accepts a correctly signed key', () => {
    const key = signLicense(payload, pair.privateKeyPem)
    expect(key.startsWith('AIHUB1.')).toBe(true)
    expect(verifyLicense(key, pair.publicKeyPem)).toEqual({ valid: true, payload })
  })

  it('tolerates whitespace and line breaks from copy-paste', () => {
    const key = signLicense(payload, pair.privateKeyPem)
    const messy = `  ${key.slice(0, 20)}\n${key.slice(20, 50)} \r\n${key.slice(50)}  `
    expect(verifyLicense(messy, pair.publicKeyPem).valid).toBe(true)
  })

  it('rejects keys signed with another private key', () => {
    const key = signLicense(payload, other.privateKeyPem)
    expect(verifyLicense(key, pair.publicKeyPem)).toEqual({ valid: false, reason: 'signature' })
  })

  it('rejects tampered payloads', () => {
    const key = signLicense(payload, pair.privateKeyPem)
    const [p, , s] = key.split('.')
    const forged = Buffer.from(JSON.stringify({ ...payload, name: 'Mallory' })).toString(
      'base64url'
    )
    expect(verifyLicense(`${p}.${forged}.${s}`, pair.publicKeyPem)).toEqual({
      valid: false,
      reason: 'signature'
    })
  })

  it('rejects malformed keys', () => {
    for (const k of ['', 'hello', 'AIHUB1.abc', 'AIHUB2.a.b', 'AIHUB1..']) {
      expect(verifyLicense(k, pair.publicKeyPem)).toEqual({ valid: false, reason: 'format' })
    }
    expect(verifyLicense('AIHUB1.abc.def', pair.publicKeyPem).valid).toBe(false)
  })

  it('rejects other products and expired keys', () => {
    expect(
      verifyLicense(
        signLicense({ ...payload, product: 'other' }, pair.privateKeyPem),
        pair.publicKeyPem
      )
    ).toEqual({ valid: false, reason: 'product' })
    const exp = signLicense(
      { ...payload, expiresAt: '2026-06-01T00:00:00.000Z' },
      pair.privateKeyPem
    )
    expect(verifyLicense(exp, pair.publicKeyPem, new Date('2026-05-01')).valid).toBe(true)
    expect(verifyLicense(exp, pair.publicKeyPem, new Date('2026-07-01'))).toEqual({
      valid: false,
      reason: 'expired'
    })
  })
})

describe('LicenseManager', () => {
  it('activates, persists, and deactivates', () => {
    const file = path.join(tmpDir(), 'license.json')
    const m = new LicenseManager(file, false, pair.publicKeyPem)
    expect(m.status().activated).toBe(false)
    expect(m.activate('garbage').valid).toBe(false)
    expect(m.activate(signLicense(payload, pair.privateKeyPem)).valid).toBe(true)
    const again = new LicenseManager(file, false, pair.publicKeyPem)
    expect(again.status()).toMatchObject({
      activated: true,
      licensee: 'Jane Buyer',
      licenseId: 'ORDER-1'
    })
    again.deactivate()
    expect(again.status().activated).toBe(false)
  })

  it('only allows skipping in development builds', () => {
    const prod = new LicenseManager(path.join(tmpDir(), 'l.json'), false, pair.publicKeyPem)
    expect(prod.skipForDevelopment()).toBe(false)
    expect(prod.status().devSkipped).toBeFalsy()
    const dev = new LicenseManager(path.join(tmpDir(), 'l.json'), true, pair.publicKeyPem)
    expect(dev.skipForDevelopment()).toBe(true)
    expect(dev.status()).toMatchObject({ activated: false, devSkipped: true })
  })

  it('a stored license signed by a different key is not accepted', () => {
    const file = path.join(tmpDir(), 'license.json')
    new LicenseManager(file, false, other.publicKeyPem).activate(
      signLicense(payload, other.privateKeyPem)
    )
    expect(new LicenseManager(file, false, pair.publicKeyPem).status().activated).toBe(false)
  })
})
