#!/usr/bin/env node
// Fails (exit 1) if the app still contains the placeholder license public key.
// Used by the release workflow so a release can never ship with keys nobody can sign.
import { isPlaceholderKey } from './license-lib.mjs'

if (isPlaceholderKey()) {
  console.error('src/main/license/publicKey.ts still contains the PLACEHOLDER public key.')
  console.error(
    'Run "npm run license:keypair" on your PC, commit publicKey.ts, then tag the release again.'
  )
  process.exit(1)
}
console.log('License public key OK (not the placeholder).')
