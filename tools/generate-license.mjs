#!/usr/bin/env node
// Create a license key for a buyer. NOT bundled into the app. Needs only Node.js.
//
// Interactive (asks questions):   npm run license:generate
// With options:                   npm run license:generate -- --name "Jane Doe" --email jane@example.com --id ORDER-1001
//                                 (optional: --expires 2027-12-31  --key path\to\license-private.pem)
//
// Prints the license key (AIHUB1....) to send to the buyer and records it in
// keys/issued-licenses.csv. See LICENSE_SETUP.md.
import readline from 'node:readline/promises'
import { DEFAULT_ROOT, issueLicense, parseArgs } from './license-lib.mjs'

const args = parseArgs(process.argv.slice(2))
const root = typeof args.root === 'string' ? args.root : DEFAULT_ROOT
const str = (v) => (typeof v === 'string' ? v : undefined)

let { name, email, id, expires } = {
  name: str(args.name),
  email: str(args.email),
  id: str(args.id),
  expires: str(args.expires)
}

if (!name) {
  if (!process.stdin.isTTY) {
    console.error(
      'Usage: npm run license:generate -- --name "Buyer Name" [--email x@y.z] [--id ORDER-1] [--expires YYYY-MM-DD]'
    )
    process.exit(1)
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log('Create a license key (press Enter to skip optional fields)\n')
  name = (await rl.question('Buyer name: ')).trim()
  email = (await rl.question('Buyer email (optional): ')).trim() || undefined
  id = (await rl.question('Order / license ID (optional): ')).trim() || undefined
  expires =
    (await rl.question('Expiry date YYYY-MM-DD (optional, Enter = never): ')).trim() || undefined
  rl.close()
}

try {
  const r = issueLicense(root, { name, email, id, expires, keyPath: str(args.key) })
  if (!r.matchesApp) {
    console.warn(
      '\nWARNING: this key does NOT match the public key in src/main/license/publicKey.ts.'
    )
    console.warn(
      'The app will reject it. Did you run "npm run license:keypair", commit publicKey.ts'
    )
    console.warn('and rebuild? Or are you using a different private key?\n')
  }
  console.log(`\nLicense for ${r.payload.name} (${r.payload.id}):\n`)
  console.log(r.key)
  console.log(`\nSend the line above to the buyer. Recorded in ${r.logFile}`)
} catch (err) {
  console.error(`\nError: ${err.message}\n`)
  process.exit(1)
}
