/**
 * Offline license keys: Ed25519 signatures. No Electron imports, so this module is shared by
 * the app's verification and the tests. tools/license-lib.mjs is a dependency-free copy of the
 * signing side (kept compatible by tests/license-tools.test.ts).
 *
 * Format:  AIHUB1.<base64url(JSON payload)>.<base64url(signature over the payload segment)>
 */
import crypto from 'node:crypto'

export const LICENSE_PREFIX = 'AIHUB1'
export const PRODUCT_ID = 'ai-hub'

export interface LicensePayload {
  v: 1
  product: string
  /** Unique license id, e.g. order number. */
  id: string
  name: string
  email?: string
  /** ISO date */
  issuedAt: string
  /** Optional ISO expiry date. */
  expiresAt?: string
}

export type VerifyResult =
  | { valid: true; payload: LicensePayload }
  | { valid: false; reason: 'format' | 'signature' | 'product' | 'expired' }

const b64url = (buf: Buffer) => buf.toString('base64url')

/** Normalise user input: strip whitespace/newlines that come from copy-paste. */
export function normalizeLicenseKey(key: string): string {
  return key.replace(/\s+/g, '')
}

export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signingInput = `${LICENSE_PREFIX}.${body}`
  const sig = crypto.sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    crypto.createPrivateKey(privateKeyPem)
  )
  return `${signingInput}.${b64url(sig)}`
}

export function verifyLicense(
  rawKey: string,
  publicKeyPem: string,
  now: Date = new Date()
): VerifyResult {
  const key = normalizeLicenseKey(rawKey)
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX || !parts[1] || !parts[2]) {
    return { valid: false, reason: 'format' }
  }
  const signingInput = `${parts[0]}.${parts[1]}`
  let ok = false
  try {
    ok = crypto.verify(
      null,
      Buffer.from(signingInput, 'utf8'),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(parts[2], 'base64url')
    )
  } catch {
    return { valid: false, reason: 'signature' }
  }
  if (!ok) return { valid: false, reason: 'signature' }

  let payload: LicensePayload
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as LicensePayload
  } catch {
    return { valid: false, reason: 'format' }
  }
  if (payload.product !== PRODUCT_ID) return { valid: false, reason: 'product' }
  if (payload.expiresAt && Date.parse(payload.expiresAt) < now.getTime()) {
    return { valid: false, reason: 'expired' }
  }
  return { valid: true, payload }
}

export function generateKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }
}
