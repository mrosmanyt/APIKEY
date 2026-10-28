/**
 * Create a license key for a buyer. NOT bundled into the app.
 *
 *   npm run license:generate -- --name "Jane Doe" --email jane@example.com [--id ORDER-123] [--expires 2027-12-31] [--key path/to/private.pem]
 *
 * Prints the license key (AIHUB1.xxx.yyy) to send to the buyer. Also appends a line to
 * keys/issued-licenses.csv so you have a record of what you issued.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LICENSE_PUBLIC_KEY_PEM } from '../src/main/license/publicKey'
import {
  PRODUCT_ID,
  signLicense,
  verifyLicense,
  type LicensePayload
} from '../src/main/license/core'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const root = path.resolve(__dirname, '..')
const keyPath = path.resolve(arg('key') ?? path.join(root, 'keys/license-private.pem'))
const name = arg('name')
if (!name) {
  console.error(
    'Usage: npm run license:generate -- --name "Buyer Name" [--email x@y.z] [--id ORDER-1] [--expires YYYY-MM-DD] [--key private.pem]'
  )
  process.exit(1)
}
if (!fs.existsSync(keyPath)) {
  console.error(`Private key not found at ${keyPath}. Run "npm run license:keypair" first.`)
  process.exit(1)
}

const expires = arg('expires')
const payload: LicensePayload = {
  v: 1,
  product: PRODUCT_ID,
  id: arg('id') ?? `LIC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
  name,
  ...(arg('email') ? { email: arg('email') } : {}),
  issuedAt: new Date().toISOString(),
  ...(expires ? { expiresAt: new Date(expires).toISOString() } : {})
}

const key = signLicense(payload, fs.readFileSync(keyPath, 'utf8'))

// Sanity check against the public key currently embedded in the app source.
const check = verifyLicense(key, LICENSE_PUBLIC_KEY_PEM)
if (!check.valid) {
  console.warn('⚠ This key does NOT verify against src/main/license/publicKey.ts.')
  console.warn('  Did you run "npm run license:keypair" and rebuild the app?')
}

const log = path.join(root, 'keys/issued-licenses.csv')
fs.mkdirSync(path.dirname(log), { recursive: true })
if (!fs.existsSync(log)) fs.writeFileSync(log, 'issuedAt,id,name,email,expiresAt\n')
fs.appendFileSync(
  log,
  [
    payload.issuedAt,
    payload.id,
    JSON.stringify(payload.name),
    payload.email ?? '',
    payload.expiresAt ?? ''
  ].join(',') + '\n'
)

console.log(`License for ${payload.name} (${payload.id}):\n`)
console.log(key)
