#!/usr/bin/env node
// Creates your Ed25519 license-signing keypair. Run ONCE, on your own PC:
//
//   npm run license:keypair            (or:  node tools/generate-keypair.mjs)
//
// Needs only Node.js — no `npm install`. See LICENSE_SETUP.md.
import { createKeypair, DEFAULT_ROOT, parseArgs } from './license-lib.mjs'

const args = parseArgs(process.argv.slice(2))
const root = typeof args.root === 'string' ? args.root : DEFAULT_ROOT

try {
  const r = createKeypair(root, { force: args.force === true })
  console.log('')
  console.log('Done! Your license keypair was created.')
  console.log('')
  console.log('  PRIVATE key (secret!):', r.privateKey)
  console.log(
    '    -> Back this file up NOW (USB stick, password manager). Never share or commit it.'
  )
  console.log('    -> Without it you cannot create licenses that your app accepts.')
  console.log('')
  console.log('  PUBLIC key embedded in:', r.publicKeyTs)
  console.log('    -> Commit and push this file, then build the app (push a tag like v1.0.0).')
  console.log('')
  console.log('Next, create a license for a buyer:')
  console.log('  npm run license:generate')
} catch (err) {
  console.error(`\nError: ${err.message}\n`)
  process.exit(err.code === 'KEY_EXISTS' ? 2 : 1)
}
